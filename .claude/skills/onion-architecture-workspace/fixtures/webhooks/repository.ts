// Intended real path: server/src/modules/webhooks/repository.ts
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export interface InsertWebhookEvent {
  workspaceId: string;
  deliveryId: string;
  eventType: string;
  payload: unknown;
}

export class WebhooksRepository {
  constructor(private db: Db) {}

  async findByDeliveryId(deliveryId: string) {
    const [row] = await this.db
      .select()
      .from(t.webhookEvents)
      .where(eq(t.webhookEvents.deliveryId, deliveryId));
    return row;
  }

  async insert(values: InsertWebhookEvent) {
    const [row] = await this.db.insert(t.webhookEvents).values(values).returning();
    return row!;
  }
}
