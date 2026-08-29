// Intended real path: server/src/modules/notifications/repository.ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface InsertNotification {
  workspaceId: string;
  userId: string;
  kind: string;
  body: string;
}

export class NotificationsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, userId: string) {
    return this.db
      .select()
      .from(t.notifications)
      .where(and(eq(t.notifications.workspaceId, workspaceId), eq(t.notifications.userId, userId)));
  }

  async markRead(id: string) {
    const [row] = await this.db
      .update(t.notifications)
      .set({ status: 'read' })
      .where(eq(t.notifications.id, id))
      .returning();
    return row;
  }

  async insert(values: InsertNotification) {
    const [row] = await this.db
      .insert(t.notifications)
      .values({ ...values, status: 'unread' })
      .returning();
    return row!;
  }

  async userExists(userId: string) {
    const [row] = await this.db.select({ id: t.users.id }).from(t.users).where(eq(t.users.id, userId));
    return !!row;
  }
}
