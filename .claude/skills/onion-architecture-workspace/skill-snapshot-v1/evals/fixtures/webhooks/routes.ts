// Intended real path: server/src/modules/webhooks/routes.ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { WebhooksRepository } from './repository.js';
import { WebhooksService } from './service.js';

const DeliveryHeaders = z.object({
  'x-github-delivery': z.string(),
  'x-github-event': z.string(),
  'x-hub-signature-256': z.string().optional(),
});

export default async function webhooksRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new WebhooksService(app.container, process.env.WEBHOOK_SECRET ?? '');
  const repo = new WebhooksRepository(app.container.db);

  app.post('/webhooks/github', async (req, reply) => {
    const headers = DeliveryHeaders.parse(req.headers);
    const deliveryId = headers['x-github-delivery'];

    const existing = await repo.findByDeliveryId(deliveryId);
    if (existing) {
      reply.status(200);
      return { ok: true, deduped: true };
    }

    const raw = JSON.stringify(req.body);
    const event = await service.handleDelivery(
      deliveryId,
      headers['x-github-event'],
      raw,
      headers['x-hub-signature-256'],
    );
    reply.status(201);
    return { ok: true, id: event.id };
  });
}
