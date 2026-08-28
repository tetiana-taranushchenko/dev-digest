import { and, eq } from 'drizzle-orm';
import type { Brief, BriefDrop } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * brief/repository.ts — Infrastructure ring (`docs/plans/pr-brief.md`, T6).
 *
 * The ONLY file in the `brief/` module that imports `db`/`schema` — every
 * other file in this module (`service.ts`, `routes.ts`, `state-key.ts`,
 * `signals.ts`, `budget.ts`) reaches the `pr_brief` table exclusively
 * through this class's typed function surface (onion-architecture).
 */

export type BriefRow = typeof t.prBrief.$inferSelect;

/** Write shape for `upsertBrief` — every column `pr_brief` stores per
 *  generation (T4's schema), keyed by the `(prId, agentId, stateKey)`
 *  unique index that both the cache lookup and the upsert conflict target
 *  use. */
export interface UpsertBriefInput {
  prId: string;
  agentId: string;
  stateKey: string;
  headSha: string;
  docsMetaFingerprint: string;
  docsContentFingerprint: string;
  indexSha: string;
  json: Brief;
  intentAvailable: boolean;
  blastAvailable: boolean;
  droppedSections: string[];
  droppedCitations: BriefDrop[];
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  attempts: number | null;
  costUsd: number | null;
}

export class BriefRepository {
  constructor(private db: Db) {}

  /** Exact match on the unique index `(prId, agentId, stateKey)` — the
   *  single lookup BOTH the `GET` and `POST` handlers use (AC-19: a row
   *  under a different state key is never returned). */
  async getBriefByStateKey(
    prId: string,
    agentId: string,
    stateKey: string,
  ): Promise<BriefRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.prBrief)
      .where(
        and(eq(t.prBrief.prId, prId), eq(t.prBrief.agentId, agentId), eq(t.prBrief.stateKey, stateKey)),
      );
    return row;
  }

  /**
   * Upsert (AC-20) — NOT a bare insert: a regenerate at an unchanged state
   * key (e.g. `force: true` with nothing else different) must replace that
   * row, and a bare insert would hit the `(prId, agentId, stateKey)` unique
   * constraint. Different state keys still produce different rows (D8's
   * one-row-per-state-key).
   */
  async upsertBrief(values: UpsertBriefInput): Promise<BriefRow> {
    const insertValues = {
      prId: values.prId,
      agentId: values.agentId,
      stateKey: values.stateKey,
      headSha: values.headSha,
      docsMetaFingerprint: values.docsMetaFingerprint,
      docsContentFingerprint: values.docsContentFingerprint,
      indexSha: values.indexSha,
      json: values.json,
      intentAvailable: values.intentAvailable,
      blastAvailable: values.blastAvailable,
      droppedSections: values.droppedSections,
      droppedCitations: values.droppedCitations,
      provider: values.provider,
      model: values.model,
      tokensIn: values.tokensIn,
      tokensOut: values.tokensOut,
      attempts: values.attempts,
      costUsd: values.costUsd,
      generatedAt: new Date(),
    };
    const [row] = await this.db
      .insert(t.prBrief)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [t.prBrief.prId, t.prBrief.agentId, t.prBrief.stateKey],
        set: insertValues,
      })
      .returning();
    return row!;
  }
}
