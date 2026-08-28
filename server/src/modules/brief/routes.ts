import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';

const GetBriefQuery = z.object({ agent_id: z.string().uuid() });
const PostBriefBody = z.object({ agent_id: z.string().uuid(), force: z.boolean().optional() });

/**
 * brief module — Presentation ring (`docs/plans/pr-brief.md`, T6).
 *   GET  /pulls/:id/brief  → the cached `BriefResult` for the PR's CURRENT
 *                            state key; `brief: null` on a cache miss —
 *                            never derives one (cheap path).
 *   POST /pulls/:id/brief  → cache-or-generate; `force: true` bypasses the
 *                            cache LOOKUP only (still joins an in-flight
 *                            generation for the same state key).
 *
 * Thin presentation layer only — Zod validates shape (params/query/body);
 * all caching/generation/grounding logic lives in `service.ts`
 * (onion-architecture).
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container);

  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, querystring: GetBriefQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.get(workspaceId, req.params.id, req.query.agent_id, req.log);
    },
  );

  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, body: PostBriefBody },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.ensureForPull(workspaceId, req.params.id, {
        agentId: req.body.agent_id,
        force: req.body.force,
        logger: req.log,
      });
    },
  );
}
