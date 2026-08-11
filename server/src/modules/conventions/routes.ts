import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import {
  CreateConventionSkillBody,
  UpdateConventionBody,
} from './contracts.js';
import { ConventionsService } from './service.js';

const CandidateParams = z.object({
  repoId: z.string().uuid(),
  conventionId: z.string().uuid(),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new ConventionsService(app.container);

  app.get('/repos/:id/conventions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/extract',
    {
      schema: { params: IdParams },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.extract(workspaceId, req.params.id);
    },
  );

  app.patch(
    '/repos/:repoId/conventions/:conventionId',
    { schema: { params: CandidateParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.update(
        workspaceId,
        req.params.repoId,
        req.params.conventionId,
        req.body,
      );
    },
  );

  app.get('/repos/:id/conventions/skill-draft', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.getSkillDraft(workspaceId, req.params.id);
  });

  app.post(
    '/repos/:id/conventions/skill',
    { schema: { params: IdParams, body: CreateConventionSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.createSkill(workspaceId, req.params.id, req.body);
      reply.status(201);
      return skill;
    },
  );
}

