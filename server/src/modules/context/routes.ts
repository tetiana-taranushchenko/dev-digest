/**
 * context HTTP module.
 *
 *   GET  /repos/:id/context                 → ContextListing (AC-1/AC-3/AC-5/AC-20, `docs/plans/project-context.md`)
 *   POST /repos/:id/context/reindex         → IndexStatus (AC-4, `docs/plans/project-context.md`)
 *   GET  /repos/:id/context/document        → ContextDocument (AC-1, T5 `docs/plans/project-context-authoring.md`)
 *   PUT  /repos/:id/context/document        → SaveContextDocumentResult (AC-6, AC-9)
 *   POST /repos/:id/context/entries         → CreateContextEntryResult (AC-12, AC-13)
 *   POST /repos/:id/context/upload          → CreateContextEntryResult (AC-15, AC-16, AC-21)
 *
 * Thin presentation ring — Zod params/query/body validation at the boundary,
 * tenancy resolved via `getContext(container, req)` (mirrors
 * `repo-intel/routes.ts`), then a single call into `container.contextDocs`
 * (the `ContextDocsFacade`). No SQL, no filesystem access, no write-safety
 * rules here — those live in `write-safety.ts`/`write-fs.ts`/`service.ts`.
 *
 * Observability NFR: every write attempt (save/create/upload) logs exactly
 * one `req.log.info`/`warn` line carrying `{ action, path, outcome }` (plus
 * `reason` on rejection) — never the document body. `logWriteOutcome` below
 * is the only place that builds those log objects, and it is never handed
 * `content`/`bytes`, so the body cannot leak into a log line by construction.
 */
import type { FastifyInstance, FastifyBaseLogger } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type {
  ContextDocument,
  ContextIndexStatus,
  ContextListing,
  CreateContextEntryResult,
  SaveContextDocumentResult,
} from '@devdigest/shared';
import { CreateContextEntryBody, SaveContextDocumentBody } from '@devdigest/shared';
import { AppError, ValidationError } from '../../platform/errors.js';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MAX_FILE_SIZE } from './constants.js';

/** Querystring for `GET /repos/:id/context/document` — the selected document's repo-relative path (AC-1). */
const GetDocumentQuery = z.object({ path: z.string().min(1) });

/** Write actions this module logs one outcome line for (observability NFR). */
type WriteAction = 'save' | 'create' | 'upload';

/**
 * Log exactly one line for a write attempt — `{ action, path, outcome }`,
 * plus `reason` when rejected. Deliberately typed to accept only `path`
 * (never `content`/`bytes`), so a document body cannot be passed into a log
 * call from this function's call sites.
 */
function logWriteOutcome(
  log: FastifyBaseLogger,
  action: WriteAction,
  path: string,
  outcome: 'success' | 'rejected',
  reason?: string,
) {
  const fields = reason === undefined ? { action, path, outcome } : { action, path, outcome, reason };
  if (outcome === 'success') log.info(fields, `context ${action} succeeded`);
  else log.warn(fields, `context ${action} rejected`);
}

/** The rejection reason to log — an `AppError`'s stable `code`, else a generic label. */
function rejectionReason(err: unknown): string {
  return err instanceof AppError ? err.code : 'error';
}

export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;

  app.get(
    '/repos/:id/context',
    { schema: { params: IdParams } },
    async (req): Promise<ContextListing> => {
      const { workspaceId } = await getContext(container, req);
      return container.contextDocs.listDocuments(workspaceId, req.params.id);
    },
  );

  app.post(
    '/repos/:id/context/reindex',
    { schema: { params: IdParams } },
    async (req): Promise<ContextIndexStatus> => {
      // Resolve tenancy so the request is workspace-scoped even though
      // `reindex` itself re-derives the workspace from the repo id
      // (consistent with the repo-intel `resync` route).
      await getContext(container, req);
      return container.contextDocs.reindex(req.params.id);
    },
  );

  // ---- write surface (T5, `docs/plans/project-context-authoring.md`) -------

  app.get(
    '/repos/:id/context/document',
    { schema: { params: IdParams, querystring: GetDocumentQuery } },
    async (req): Promise<ContextDocument> => {
      const { workspaceId } = await getContext(container, req);
      return container.contextDocs.readDocument(workspaceId, req.params.id, req.query.path);
    },
  );

  app.put(
    '/repos/:id/context/document',
    { schema: { params: IdParams, body: SaveContextDocumentBody } },
    async (req): Promise<SaveContextDocumentResult> => {
      const { workspaceId } = await getContext(container, req);
      const { path } = req.body;
      try {
        const result = await container.contextDocs.saveDocument(workspaceId, req.params.id, req.body);
        logWriteOutcome(req.log, 'save', path, 'success');
        return result;
      } catch (err) {
        logWriteOutcome(req.log, 'save', path, 'rejected', rejectionReason(err));
        throw err;
      }
    },
  );

  app.post(
    '/repos/:id/context/entries',
    { schema: { params: IdParams, body: CreateContextEntryBody } },
    async (req): Promise<CreateContextEntryResult> => {
      const { workspaceId } = await getContext(container, req);
      const { path } = req.body;
      try {
        const result = await container.contextDocs.createEntry(workspaceId, req.params.id, req.body);
        logWriteOutcome(req.log, 'create', path, 'success');
        return result;
      } catch (err) {
        logWriteOutcome(req.log, 'create', path, 'rejected', rejectionReason(err));
        throw err;
      }
    },
  );

  app.post(
    '/repos/:id/context/upload',
    { schema: { params: IdParams } },
    async (req): Promise<CreateContextEntryResult> => {
      const { workspaceId } = await getContext(container, req);
      // Per-request multipart cap — NOT the global 256 KB registration used
      // by skill import (`app.ts:103`, untouched by this task). This is what
      // satisfies AC-21's substance by construction: the transport cap for a
      // context upload equals `MAX_FILE_SIZE` without raising skill import's
      // cap (Development Plan Recommendation 1).
      const file = await req.file({ limits: { fileSize: MAX_FILE_SIZE, files: 1 } });
      if (!file) throw new ValidationError('No file provided');
      const filename = file.filename;
      // Extension/name/size are enforced server-side regardless of the
      // client's `accept=".md"` filter — the multipart `limits.fileSize`
      // above caps the transport size, and `uploadDocument` (service ring)
      // re-validates size plus derives the stored name from `filename`
      // through the same write-safety rules `createEntry` uses; nothing
      // here trusts the client-supplied name or MIME type as-is.
      const bytes = await file.toBuffer();
      try {
        const result = await container.contextDocs.uploadDocument(workspaceId, req.params.id, {
          filename,
          bytes,
        });
        logWriteOutcome(req.log, 'upload', filename, 'success');
        return result;
      } catch (err) {
        logWriteOutcome(req.log, 'upload', filename, 'rejected', rejectionReason(err));
        throw err;
      }
    },
  );
}
