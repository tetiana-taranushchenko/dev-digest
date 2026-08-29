// Intended real path: server/src/modules/users/repository.ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

export interface InsertUser {
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export interface UpdateUser {
  name?: string;
  email?: string;
  role?: 'admin' | 'user';
}

export class UsersRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string) {
    return this.db
      .select()
      .from(t.users)
      .where(eq(t.users.workspaceId, workspaceId));
  }

  async getById(workspaceId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(t.users)
      .where(and(eq(t.users.workspaceId, workspaceId), eq(t.users.id, id)));
    return row;
  }

  async insert(workspaceId: string, values: InsertUser) {
    const [row] = await this.db
      .insert(t.users)
      .values({ workspaceId, ...values })
      .returning();
    return row!;
  }

  async update(workspaceId: string, id: string, patch: UpdateUser) {
    const [row] = await this.db
      .update(t.users)
      .set(patch)
      .where(and(eq(t.users.workspaceId, workspaceId), eq(t.users.id, id)))
      .returning();
    return row;
  }

  async delete(workspaceId: string, id: string) {
    const rows = await this.db
      .delete(t.users)
      .where(and(eq(t.users.workspaceId, workspaceId), eq(t.users.id, id)))
      .returning({ id: t.users.id });
    return rows.length > 0;
  }
}

export {
  type typeof t.users.$inferSelect as UserRow,
};
