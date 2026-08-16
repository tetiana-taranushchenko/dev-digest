import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { IntentService } from './service.js';

/**
 * intent module.
 *   GET  /pulls/:id/intent  → the persisted `PrIntentRecord`; 404 when no
 *                             COMPLETE intent has been derived yet.
 *   POST /pulls/:id/intent  → force-recompute; always calls the LLM.
 *
 * Thin presentation layer only — Zod validates shape (params), all
 * "has this PR been classified" / "is the cache stale" logic lives in
 * `service.ts` (onion-architecture).
 */
export default async function intentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new IntentService(container);

  app.get('/pulls/:id/intent', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.get(workspaceId, req.params.id);
  });

  app.post(
    '/pulls/:id/intent',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.classify(workspaceId, req.params.id, req.log);
    },
  );
}
