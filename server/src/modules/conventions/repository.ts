import { and, desc, eq, sql } from 'drizzle-orm';
import type { ConventionCategory, ConventionStatus } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';

export interface InsertConvention {
  category: ConventionCategory;
  rule: string;
  evidencePath: string;
  evidenceLine: number;
  evidenceSnippet: string;
  evidenceRef: string;
  confidence: number;
}

export interface ConventionPatch {
  category?: ConventionCategory;
  rule?: string;
  status?: ConventionStatus;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)),
      )
      .orderBy(
        sql`case when ${t.conventions.accepted} then 0 when ${t.conventions.rejected} then 2 else 1 end`,
        desc(t.conventions.confidence),
      );
  }

  async listApproved(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.accepted, true),
          eq(t.conventions.rejected, false),
        ),
      )
      .orderBy(desc(t.conventions.confidence));
  }

  /** Keep old results until all new candidates have been extracted and verified. */
  async replaceAll(
    workspaceId: string,
    repoId: string,
    candidates: InsertConvention[],
  ): Promise<ConventionRow[]> {
    return this.db.transaction(async (tx) => {
      await tx
        .delete(t.conventions)
        .where(
          and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)),
        );
      if (candidates.length === 0) return [];
      return tx
        .insert(t.conventions)
        .values(
          candidates.map((candidate) => ({
            workspaceId,
            repoId,
            ...candidate,
            accepted: false,
            rejected: false,
          })),
        )
        .returning();
    });
  }

  async update(
    workspaceId: string,
    repoId: string,
    id: string,
    patch: ConventionPatch,
  ): Promise<ConventionRow | undefined> {
    const decision =
      patch.status === undefined
        ? {}
        : patch.status === 'approved'
          ? { accepted: true, rejected: false }
          : patch.status === 'rejected'
            ? { accepted: false, rejected: true }
            : { accepted: false, rejected: false };
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
        ...decision,
      })
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.id, id),
        ),
      )
      .returning();
    return row;
  }
}

