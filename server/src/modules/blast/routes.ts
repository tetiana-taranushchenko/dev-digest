import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module.
 *   GET /pulls/:id/blast → the Blast Radius view (changed symbols, their
 *                           callers, and reachable HTTP endpoints/cron jobs),
 *                           derived from the persisted repo-intel index only.
 *                           No AST/import-graph recomputation and no LLM call
 *                           on this path (REQ-5, REQ-9).
 *
 * Thin presentation layer only — Zod validates shape (params), all
 * coordination/mapping logic lives in `service.ts`/`assemble.ts`
 * (onion-architecture). Mirrors `smart-diff/routes.ts` exactly.
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams } },
    async (req): Promise<BlastRadius> => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id);
    },
  );
}
