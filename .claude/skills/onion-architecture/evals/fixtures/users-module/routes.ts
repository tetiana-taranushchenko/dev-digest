// Intended real path: server/src/modules/users/routes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { UsersService } from './service.js';

const CreateUserBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'user']),
});

const UpdateUserBody = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(['admin', 'user']).optional(),
});

export default async function usersRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new UsersService(app.container);

  app.get('/users', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.listUsers(workspaceId);
  });

  app.get('/users/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const user = await service.getUser(workspaceId, req.params.id);
    if (!user) throw new NotFoundError('User not found');
    return user;
  });

  app.post('/users', { schema: { body: CreateUserBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const user = await service.createUser(
      workspaceId,
      req.body.name,
      req.body.email,
      req.body.role,
    );
    reply.status(201);
    return user;
  });

  app.put(
    '/users/:id',
    { schema: { params: IdParams, body: UpdateUserBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const user = await service.updateUser(workspaceId, req.params.id, req.body);
      if (!user) throw new NotFoundError('User not found');
      return user;
    },
  );

  app.delete('/users/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.deleteUser(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('User not found');
    return { ok: true };
  });
}
