import type { Agent, PrFile, ReviewRecord } from "@devdigest/shared";
import { buildDiffLineRoute } from "../DiffTab/helpers";
import type { BriefUsage, BriefVerdictInfo } from "./types";

/** Deterministic default-agent pick for the Brief (Recommendation 1 — no new
 *  agent-selector UI). `Agent` has no `default`/`created_at` field, so
 *  "enabled, sorted by name then id" is the only stable ordering available
 *  without a server change. Filtering to enabled agents also keeps this
 *  consistent with the server's disabled-agent rejection (S-2) — a disabled
 *  agent is never even offered as the default. */
export function pickDefaultAgent(agents: Agent[]): string | null {
  return (
    agents
      .filter((agent) => agent.enabled)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0]?.id ?? null
  );
}

/** Where a review-focus item's `file:line` should navigate. AC-26/AC-27:
 *  in-app via the existing `?tab=diff&file=&line=` deep link when the file is
 *  part of this PR's diff; otherwise a client-side backstop — no navigation,
 *  no external fallback (the Brief has no GitHub blob context to fall back
 *  to, unlike Blast Radius's caller rows). */
export type ReviewFocusDestination = { kind: "in-app"; route: string } | { kind: "not-in-diff" };

export function resolveReviewFocusDestination(params: {
  file: string;
  line: number;
  files: PrFile[];
  repoId: string;
  prNumber: number;
}): ReviewFocusDestination {
  const { file, line, files, repoId, prNumber } = params;
  const inDiff = files.some((f) => f.path === file);
  if (!inDiff) return { kind: "not-in-diff" };
  return { kind: "in-app", route: buildDiffLineRoute(repoId, prNumber, file, line) };
}

/** `1234` -> `"1.2K"`, `999` -> `"999"` — matches the reference design's
 *  compact token count style (`specs/design-references/pr-brief/`). Display
 *  only, never used for any Brief content decision. */
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}K`;
}

/** Formats `usage` for the Brief summary's cost/token line, or `null` when
 *  there is nothing to show (no usage recorded, or both tokens counts are
 *  unknown). Cost is shown to 3 decimal places (this feature's per-call cost
 *  is typically sub-cent), tokens as `in→out`. */
export function formatBriefUsage(usage: BriefUsage | null): { cost: string | null; tokens: string | null } | null {
  if (!usage) return null;
  const cost = usage.costUsd != null ? `$${usage.costUsd.toFixed(3)}` : null;
  const tokens =
    usage.tokensIn != null && usage.tokensOut != null
      ? `${formatTokenCount(usage.tokensIn)}→${formatTokenCount(usage.tokensOut)}`
      : null;
  if (!cost && !tokens) return null;
  return { cost, tokens };
}

/** Picks the most recent completed review run with a verdict and derives the
 *  same fields `VerdictBanner`/`ReviewRunAccordion` show (`blockers` uses the
 *  identical `severity === "CRITICAL" && !dismissed_at` rule as
 *  `ReviewRunAccordion.tsx`, so the count matches what a user sees on the
 *  Findings tab for that same run). `reviews` is expected newest-first
 *  (`usePrReviews`'s documented order) — the first entry with a non-null
 *  `verdict` wins; a `kind: 'summary'` record or one still missing a verdict
 *  is skipped. Returns `null` when no run has completed yet. */
export function deriveVerdictInfo(reviews: ReviewRecord[]): BriefVerdictInfo | null {
  const latest = reviews.find((r) => r.verdict != null);
  if (!latest || !latest.verdict) return null;
  return {
    verdict: latest.verdict,
    score: latest.score,
    findingsCount: latest.findings.length,
    blockers: latest.findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length,
    agentName: latest.agent_name,
  };
}
