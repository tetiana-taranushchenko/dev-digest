import { z } from 'zod';
import { CommunitySkill, SkillType } from '@devdigest/shared';

/**
 * A1 — module-local Skills Stats contract (Phase 7).
 *
 * NOT part of `vendor/shared/contracts/*` on purpose: `observability.ts`
 * already defines `AgentStats` (per-agent quality aggregates) as a DESIGN
 * PRECEDENT we mirror the naming/shape conventions of here (snake_case
 * fields, `_rate` as a 0..1 float-or-null, breakdown objects) — but
 * `SkillStats` is a distinct shape answering a distinct question, so it
 * lives here instead of being bolted onto the vendor contract.
 *
 * FRAMING (important, also surfaced as UI copy — see StatsTab): every number
 * below describes "findings/runs from agents that currently have this skill
 * attached" — NEVER "findings this skill caused". A finding can't yet be
 * attributed to one specific skill among an agent's several.
 */
export const SkillStats = z.object({
  skill_id: z.string(),
  skill_name: z.string(),
  /** How many agents (in this workspace) currently have this skill linked. */
  agent_count: z.number().int(),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  /**
   * % of the workspace's PRs in the last 30 days reviewed by >=1 agent with
   * this skill attached. Null when the workspace had no agent runs at all
   * in the window (denominator is 0) — 0 is a valid, meaningful value.
   */
  pull_frequency: z.number().nullable(),
  /**
   * accepted / (accepted + dismissed) over ALL findings (lifetime, not just
   * the last 30 days) from agents with this skill attached. Null (not 0)
   * when that denominator is 0 — i.e. nothing has been acted on yet.
   */
  accept_rate: z.number().nullable(),
  accepted: z.number().int(),
  dismissed: z.number().int(),
  pending: z.number().int(),
  /** Real count of findings created (via reviews.created_at) in the last 30 days. */
  findings_30d: z.number().int(),
  /** Same 30-day window, broken down by finding category. */
  findings_by_category: z.record(z.string(), z.number().int()),
  /**
   * NOT a measured value — an ALLOCATION ESTIMATE. Each contributing run's
   * `cost_usd` is split evenly across its `findings_count` findings, and
   * each finding's share is summed into its category. Runs with a null cost
   * or zero findings are skipped (their per-finding cost is undefined, not
   * zero). Must be labelled as an estimate wherever it's shown.
   */
  estimated_cost_by_category: z.record(z.string(), z.number()),
});
export type SkillStats = z.infer<typeof SkillStats>;

/**
 * The cheap subset of `SkillStats` attached to each item of `GET
 * /skills?include=stats` — deliberately excludes findings/category
 * breakdowns and cost allocation so the list endpoint stays fast.
 */
export const CompactSkillStats = z.object({
  agent_count: z.number().int(),
  pull_frequency: z.number().nullable(),
  accept_rate: z.number().nullable(),
});
export type CompactSkillStats = z.infer<typeof CompactSkillStats>;

/**
 * A curated, static community-skill catalog entry (Phase 9). EXTENDS the
 * vendored `CommunitySkill` ({name, repo, stars, lang, desc}) with a `slug`
 * (import key), `topics` (the security/performance-style filter chips), and
 * the full skill `body` inline — the catalog is a small in-repo fixture, not
 * a live index, so import needs no network call. This is intentionally a
 * module-local extension rather than an edit to the vendored contract (see
 * SkillStats above for the same rationale).
 */
export const CommunityCatalogEntry = CommunitySkill.extend({
  slug: z.string(),
  topics: z.array(z.string()).default([]),
  type: SkillType,
  body: z.string(),
});
export type CommunityCatalogEntry = z.infer<typeof CommunityCatalogEntry>;
