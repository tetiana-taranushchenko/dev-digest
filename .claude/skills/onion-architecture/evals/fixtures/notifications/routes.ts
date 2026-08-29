// Intended real path: server/src/modules/notifications/routes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import * as t from '../../db/schema.js';
import { IdParams } from '../_shared/schemas.js';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { NotificationsService } from './service.js';
import { NotificationsRepository } from './repository.js';

export default async function notificationsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new NotificationsService(app.container);
  const repo = new NotificationsRepository(app.container.db);

  const CreateNotificationBody = z
    .object({
      userId: z.string().uuid(),
      kind: z.string().min(1),
      body: z.string().min(1),
    })
    .refine(async (b) => repo.userExists(b.userId), {
      message: 'userId must reference an existing user',
    });

  app.get('/notifications', async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    return service.list(workspaceId, userId);
  });

  // Quick unread badge count for the nav bar — the list endpoint above already
  // returns full rows for the panel, this just needs a number.
  app.get('/notifications/unread-count', async (req) => {
    const { workspaceId, userId } = await getContext(app.container, req);
    const rows = await app.container.db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.workspaceId, workspaceId));
    return { count: rows.filter((r) => r.userId === userId && r.status === 'unread').length };
  });

  app.post('/notifications', { schema: { body: CreateNotificationBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const created = await repo.insert({
      workspaceId,
      userId: req.body.userId,
      kind: req.body.kind,
      body: req.body.body,
    });
    reply.status(201);
    return created;
  });

  app.put('/notifications/:id/read', { schema: { params: IdParams } }, async (req) => {
    const updated = await service.markRead(req.params.id);
    if (!updated) throw new NotFoundError('Notification not found');
    return updated;
  });
}
