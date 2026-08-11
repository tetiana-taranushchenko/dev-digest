import { and, count, countDistinct, eq, gte, inArray, isNotNull, sql, sum } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * A1 — skills STATS data-access (Phase 7). Kept as its own file, sibling to
 * `repository.ts`, so the CRUD repo doesn't balloon with aggregate SQL —
 * mirrors how the reviews module splits its repository by aggregate (see
 * `modules/reviews/repository/{review,run,pull}.repo.ts`).
 *
 * FRAMING (see contracts.ts): every query here answers "findings/runs from
 * agents that have this skill attached" — never "caused by this skill".
 *
 * Every query is driven by an explicit `agentIds` list (the workspace-scoped
 * agents currently linked to a skill, from `SkillsRepository.agentsForSkill`
 * / `agentsForSkills`) — this repo does not know about `agent_skills` itself.
 */

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function thirtyDaysAgo(now: Date = new Date()): Date {
  return new Date(now.getTime() - THIRTY_DAYS_MS);
}

export interface FindingTotals {
  accepted: number;
  dismissed: number;
  pending: number;
}

export interface Findings30d {
  total: number;
  byCategory: Record<string, number>;
}

export class SkillStatsRepository {
  constructor(private db: Db) {}

  /**
   * Lifetime accepted/dismissed/pending counts over findings whose review
   * was produced by one of `agentIds`. `acceptedAt`/`dismissedAt` are
   * mutually exclusive nullable timestamps on `findings`; both null = pending.
   */
  async findingTotals(agentIds: string[]): Promise<FindingTotals> {
    if (agentIds.length === 0) return { accepted: 0, dismissed: 0, pending: 0 };
    const [row] = await this.db
      .select({
        accepted: count(sql`CASE WHEN ${t.findings.acceptedAt} IS NOT NULL THEN 1 END`),
        dismissed: count(sql`CASE WHEN ${t.findings.dismissedAt} IS NOT NULL THEN 1 END`),
        pending: count(
          sql`CASE WHEN ${t.findings.acceptedAt} IS NULL AND ${t.findings.dismissedAt} IS NULL THEN 1 END`,
        ),
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(inArray(t.reviews.agentId, agentIds));
    return {
      accepted: row?.accepted ?? 0,
      dismissed: row?.dismissed ?? 0,
      pending: row?.pending ?? 0,
    };
  }

  /** accept_rate over the same population as `findingTotals`, without the
   *  extra `pending` count — used by the list endpoint's compact stats. */
  async acceptRate(agentIds: string[]): Promise<number | null> {
    if (agentIds.length === 0) return null;
    const [row] = await this.db
      .select({
        accepted: count(sql`CASE WHEN ${t.findings.acceptedAt} IS NOT NULL THEN 1 END`),
        dismissed: count(sql`CASE WHEN ${t.findings.dismissedAt} IS NOT NULL THEN 1 END`),
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(inArray(t.reviews.agentId, agentIds));
    const accepted = row?.accepted ?? 0;
    const dismissed = row?.dismissed ?? 0;
    const denom = accepted + dismissed;
    return denom === 0 ? null : accepted / denom;
  }

  /**
   * Real findings created in the last 30 days, by category. Uses
   * `reviews.created_at` (`findings` has no timestamp column of its own —
   * confirmed against db/schema/reviews.ts).
   */
  async findings30d(agentIds: string[], since: Date): Promise<Findings30d> {
    if (agentIds.length === 0) return { total: 0, byCategory: {} };
    const rows = await this.db
      .select({ category: t.findings.category, n: count() })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .where(and(inArray(t.reviews.agentId, agentIds), gte(t.reviews.createdAt, since)))
      .groupBy(t.findings.category);
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      byCategory[r.category] = r.n;
      total += r.n;
    }
    return { total, byCategory };
  }

  /**
   * Cost-allocation ESTIMATE by category (lifetime, not 30d-windowed — this
   * mirrors accept_rate/findingTotals, which are also lifetime signals).
   * For each run produced by one of `agentIds` with a known cost and at
   * least one finding, `cost_usd / findings_count` is each finding's share;
   * shares are summed per the finding's category. Runs with a null cost or
   * zero findings are skipped entirely (undefined share, not a zero share).
   *
   * Findings are linked to the run that produced them via
   * `findings.reviewId -> reviews.id -> reviews.runId -> agent_runs.id`; the
   * inner joins naturally drop findings whose review has no matching run.
   */
  async estimatedCostByCategory(agentIds: string[]): Promise<Record<string, number>> {
    if (agentIds.length === 0) return {};
    const rows = await this.db
      .select({
        category: t.findings.category,
        cost: sum(sql`${t.agentRuns.costUsd} / ${t.agentRuns.findingsCount}`),
      })
      .from(t.findings)
      .innerJoin(t.reviews, eq(t.reviews.id, t.findings.reviewId))
      .innerJoin(t.agentRuns, eq(t.agentRuns.id, t.reviews.runId))
      .where(
        and(
          inArray(t.agentRuns.agentId, agentIds),
          isNotNull(t.agentRuns.costUsd),
          sql`${t.agentRuns.findingsCount} > 0`,
        ),
      )
      .groupBy(t.findings.category);
    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.category] = Number(r.cost ?? 0);
    return byCategory;
  }

  /** Distinct PRs (in this workspace) reviewed by ANY agent in the window —
   *  the shared denominator for `pull_frequency` across every skill. */
  async workspacePrCount(workspaceId: string, since: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: countDistinct(t.agentRuns.prId) })
      .from(t.agentRuns)
      .where(and(eq(t.agentRuns.workspaceId, workspaceId), gte(t.agentRuns.ranAt, since)));
    return row?.n ?? 0;
  }

  /** Distinct PRs reviewed by one of `agentIds` in the window — the numerator. */
  async prCountForAgents(agentIds: string[], since: Date): Promise<number> {
    if (agentIds.length === 0) return 0;
    const [row] = await this.db
      .select({ n: countDistinct(t.agentRuns.prId) })
      .from(t.agentRuns)
      .where(and(inArray(t.agentRuns.agentId, agentIds), gte(t.agentRuns.ranAt, since)));
    return row?.n ?? 0;
  }

  /** `pull_frequency` for a single skill: numerator/denominator over the
   *  same 30d window. Null when the workspace had no activity at all. */
  async pullFrequency(workspaceId: string, agentIds: string[], since: Date): Promise<number | null> {
    const denom = await this.workspacePrCount(workspaceId, since);
    if (denom === 0) return null;
    if (agentIds.length === 0) return 0;
    const numerator = await this.prCountForAgents(agentIds, since);
    return numerator / denom;
  }
}
