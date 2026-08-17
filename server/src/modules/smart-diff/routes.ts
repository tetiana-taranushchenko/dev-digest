import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SmartDiff } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { SmartDiffService } from './service.js';

/**
 * smart-diff module.
 *   GET /pulls/:id/smart-diff → the risk-ordered Files-changed grouping
 *                                (`core` / `wiring` / `boilerplate`), derived
 *                                on the fly from persisted `pr_files` +
 *                                findings. No LLM call (REQ-6).
 *
 * Thin presentation layer only — Zod validates shape (params), all
 * grouping/classification logic lives in `service.ts`/`assemble.ts`/
 * `classify.ts` (onion-architecture).
 */
export default async function smartDiffRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new SmartDiffService(container);

  app.get(
    '/pulls/:id/smart-diff',
    { schema: { params: IdParams } },
    async (req): Promise<SmartDiff> => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id);
    },
  );
}
