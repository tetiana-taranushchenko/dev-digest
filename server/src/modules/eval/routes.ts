import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput, EvalOwnerKind } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * eval module (T6) — thin presentation layer only. Zod validates request
 * shape; all coordination/business logic lives in `service.ts` (T5) and the
 * pure/data-access files it composes (`scorer.ts`, `dashboard.ts`,
 * `run-tracker.ts`, `repository.ts`), per onion-architecture.
 *
 *   POST   /eval-cases                    → create (AC-1)
 *   GET    /eval-cases                     → list, ?owner_kind=&owner_id= (AC-2)
 *   GET    /eval-cases/:id                 → one case
 *   PUT    /eval-cases/:id                 → update
 *   DELETE /eval-cases/:id                 → delete (runs cascade via FK, AC-5)
 *   POST   /eval-cases/:id/run             → run one case synchronously (AC-7)
 *   POST   /eval-cases/run-all             → bulk run; body {owner_kind?, owner_id?}
 *                                             — both present = one owner (AC-13),
 *                                             both absent = whole workspace (AC-43)
 *   GET    /eval-cases/run-all/:batchId    → poll bulk-run progress (AC-47)
 *   GET    /eval-dashboard                 → aggregate dashboard, ?owner_kind=&owner_id= (AC-16, AC-17)
 *   GET    /eval-dashboard/overview        → one dashboard per owner with ≥1 case (AC-31)
 *   POST   /findings/:id/eval-seed         → build an (unsaved) EvalCaseInput from a finding (AC-27)
 *
 * The seed route is deliberately independent of `reviews/routes.ts`'s
 * accept/dismiss finding-action enum — seeding is not a finding action,
 * it's a read that returns a draft eval case (AC-29).
 */

/** `GET /eval-cases`, `GET /eval-dashboard` — both filters optional (AC-2, AC-17). */
const EvalOwnerFilterQuery = z.object({
  owner_kind: EvalOwnerKind.optional(),
  owner_id: z.string().optional(),
});

/** `POST /eval-cases/run-all` body — both filters optional (AC-13/AC-43). */
const BulkRunBody = z.object({
  owner_kind: EvalOwnerKind.optional(),
  owner_id: z.string().optional(),
});

/** Bulk-run batch ids are scope keys (`` `${owner_kind}:${owner_id}` ``), not
 *  uuids — see `run-tracker.ts`'s `scopeKeyFor` — so this can't reuse `IdParams`. */
const BatchIdParams = z.object({ batchId: z.string().min(1) });

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container);

  // ---- CRUD (AC-1, AC-2, AC-4) --------------------------------------------

  app.post('/eval-cases', { schema: { body: EvalCaseInput } }, async (req, reply) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.createCase(workspaceId, req.body);
    reply.status(201);
    return evalCase;
  });

  app.get('/eval-cases', { schema: { querystring: EvalOwnerFilterQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listCases(workspaceId, {
      ownerKind: req.query.owner_kind,
      ownerId: req.query.owner_id,
    });
  });

  app.get('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const evalCase = await service.getCase(workspaceId, req.params.id);
    if (!evalCase) throw new NotFoundError('Eval case not found');
    return evalCase;
  });

  app.put(
    '/eval-cases/:id',
    { schema: { params: IdParams, body: EvalCaseInput } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      const evalCase = await service.updateCase(workspaceId, req.params.id, req.body);
      if (!evalCase) throw new NotFoundError('Eval case not found');
      return evalCase;
    },
  );

  app.delete('/eval-cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok: true };
  });

  // ---- Running (AC-7, AC-13, AC-42, AC-47) --------------------------------

  app.post('/eval-cases/:id/run', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.runCase(workspaceId, req.params.id);
  });

  app.post('/eval-cases/run-all', { schema: { body: BulkRunBody } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.startBulkRun(
      workspaceId,
      { ownerKind: req.body.owner_kind, ownerId: req.body.owner_id },
      req.log,
    );
  });

  app.get(
    '/eval-cases/run-all/:batchId',
    { schema: { params: BatchIdParams } },
    async (req) => {
      const batch = service.bulkRunStatus(req.params.batchId);
      if (!batch) throw new NotFoundError('Eval run batch not found');
      return batch;
    },
  );

  // ---- Dashboard (AC-16, AC-17, AC-31) ------------------------------------

  app.get('/eval-dashboard', { schema: { querystring: EvalOwnerFilterQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getDashboard(workspaceId, {
      ownerKind: req.query.owner_kind,
      ownerId: req.query.owner_id,
    });
  });

  app.get('/eval-dashboard/overview', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getOverview(workspaceId);
  });

  // ---- Seed from finding (AC-27) ------------------------------------------

  app.post('/findings/:id/eval-seed', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.seedFromFinding(workspaceId, req.params.id);
  });
}
