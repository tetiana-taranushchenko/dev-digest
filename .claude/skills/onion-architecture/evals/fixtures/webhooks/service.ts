// Intended real path: server/src/modules/webhooks/service.ts
import type { Container } from '../../platform/container.js';
import { WebhooksRepository } from './repository.js';
import { HmacWebhookVerifier } from '../../adapters/webhooks/hmac-verifier.js';
import { db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export class WebhooksService {
  private repo: WebhooksRepository;
  private verifier: HmacWebhookVerifier;

  constructor(private container: Container, secret: string) {
    this.repo = new WebhooksRepository(container.db);
    this.verifier = new HmacWebhookVerifier(secret);
  }

  async handleDelivery(
    deliveryId: string,
    eventType: string,
    rawPayload: string,
    signature: string | undefined,
  ) {
    if (!this.verifier.verify(rawPayload, signature)) {
      throw new Error('invalid signature');
    }

    const existing = await this.repo.findByDeliveryId(deliveryId);
    if (existing) return existing;

    const payload = JSON.parse(rawPayload);
    const workspace = await db
      .select()
      .from(t.workspaces)
      .where(eq(t.workspaces.id, payload.workspace_id));
    if (workspace.length === 0) throw new Error('unknown workspace');

    return this.repo.insert({
      workspaceId: payload.workspace_id,
      deliveryId,
      eventType,
      payload,
    });
  }
}
