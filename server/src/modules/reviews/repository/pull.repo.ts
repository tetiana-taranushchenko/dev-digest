import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { IntentAssessment, PrIntentRecord } from '@devdigest/shared';
import type { PullRow, RepoRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

export async function getRepo(db: Db, repoId: string): Promise<RepoRow | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/** Newest `limit` commits for a PR (message + committedAt), ordered
 *  newest-first. Used by the intent signal gatherer's `commit_messages`
 *  signal (§1) — kept here rather than a direct DB query in that module so
 *  the application layer never imports Drizzle/schema directly. */
export async function getPrCommits(
  db: Db,
  prId: string,
  limit: number,
): Promise<{ message: string; committedAt: Date | null }[]> {
  return db
    .select({ message: t.prCommits.message, committedAt: t.prCommits.committedAt })
    .from(t.prCommits)
    .where(eq(t.prCommits.prId, prId))
    .orderBy(desc(t.prCommits.committedAt))
    .limit(limit);
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent -----------------------------------------------------------------

/**
 * Write shape for `upsertIntent`: the full public `IntentAssessment` contract
 * (intent, scope lists, confidence tier + reason, sources, provider/model,
 * generated_at) PLUS the observability-only columns that exist on `pr_intent`
 * for caching/cost tracking but are deliberately NOT part of the public
 * `IntentAssessment`/`PrIntentRecord` contracts (see plan §3's column table —
 * `head_sha` is the cache key, the rest are per-classification cost/latency).
 */
export type UpsertIntentInput = IntentAssessment & {
  headSha: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  durationMs: number | null;
};

/**
 * `getIntent`'s return type honestly reflects DB nullability rather than the
 * stricter `PrIntentRecord` contract: `provider`/`model`/`confidence_reason`
 * are nullable columns (T2, kept nullable so the pre-widening insert shape
 * still typechecked), so a legacy/partial row (or one written before a full
 * classification completed) round-trips with `null` in those fields instead
 * of throwing here. Enforcing "no full assessment yet == not found" is a
 * domain invariant, not a repository concern — deciding that belongs to
 * `modules/intent/service.ts` (T7), which is expected to treat
 * `provider === null` (or any of the three) as equivalent to "no intent
 * record" and surface the route's `404 NotFoundError` from there. This
 * mirrors the existing convention in this file/`repository.ts`: `get*`
 * methods return `T | undefined` only for "row does not exist", and
 * `NotFoundError` is thrown by the service/route layer (e.g.
 * `reviews/service.ts:110`), never fabricated inside the repository.
 */
export type IntentRow = Omit<PrIntentRecord, 'provider' | 'model' | 'confidence_reason'> & {
  provider: string | null;
  model: string | null;
  confidence_reason: string | null;
  /** Observability-only columns (not part of the public `PrIntentRecord`
   *  contract) — added additively here so the service layer's cache-check
   *  can compare `head_sha` without a second query. `toRecord()` in
   *  `modules/intent/service.ts` picks only the public fields back out. */
  headSha: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
  durationMs: number | null;
};

export async function upsertIntent(db: Db, prId: string, input: UpsertIntentInput): Promise<void> {
  const values = {
    prId,
    intent: input.intent,
    inScope: input.in_scope,
    outOfScope: input.out_of_scope,
    confidence: input.confidence,
    confidenceReason: input.confidence_reason,
    sources: input.sources,
    provider: input.provider,
    model: input.model,
    headSha: input.headSha,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    costUsd: input.costUsd,
    durationMs: input.durationMs,
    generatedAt: new Date(input.generated_at),
  };
  await db
    .insert(t.prIntent)
    .values(values)
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: {
        intent: values.intent,
        inScope: values.inScope,
        outOfScope: values.outOfScope,
        confidence: values.confidence,
        confidenceReason: values.confidenceReason,
        sources: values.sources,
        provider: values.provider,
        model: values.model,
        headSha: values.headSha,
        tokensIn: values.tokensIn,
        tokensOut: values.tokensOut,
        costUsd: values.costUsd,
        durationMs: values.durationMs,
        generatedAt: values.generatedAt,
      },
    });
}

export async function getIntent(db: Db, prId: string): Promise<IntentRow | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return {
    pr_id: row.prId,
    intent: row.intent,
    in_scope: row.inScope,
    out_of_scope: row.outOfScope,
    confidence: row.confidence,
    confidence_reason: row.confidenceReason,
    sources: row.sources,
    provider: row.provider,
    model: row.model,
    generated_at: row.generatedAt.toISOString(),
    headSha: row.headSha,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    costUsd: row.costUsd,
    durationMs: row.durationMs,
  };
}
