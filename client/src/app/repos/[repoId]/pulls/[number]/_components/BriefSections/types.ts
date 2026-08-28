import type { Brief, Verdict } from "@devdigest/shared";

/** Shared state returned by `useBriefSections` (called exactly once, by
 *  `OverviewTab.tsx`) and passed as a prop to all three Brief panels — this
 *  is what makes AC-25 (loading coordination) and AC-28 (error coordination)
 *  actually true, since every consumer reads the same object. */
/** Generation cost/token usage for the current `brief` (AC-29 data, already
 *  logged server-side; surfaced here only for the summary's cost/token
 *  display — never used for any Brief content decision). `null` when the
 *  stored row predates this field or usage genuinely isn't known. */
export interface BriefUsage {
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
}

/** The PR's most recent completed review run's verdict/score/findings —
 *  NOT part of the Brief's own model output (Brief has no verdict concept).
 *  Deliberately merged into the same Overview-tab card as the Brief's
 *  what/why/risk_level by explicit product direction (2026-08-29), reversing
 *  the spec's original D12 ("own visual identity, distinct from the verdict
 *  banner"). `null` until at least one review run has completed for this PR. */
export interface BriefVerdictInfo {
  verdict: Verdict;
  score: number | null;
  findingsCount: number;
  blockers: number;
  agentName?: string | null;
}

export interface BriefSectionsState {
  status: "no-agent" | "loading" | "empty" | "error" | "ready";
  brief: Brief | null;
  usage: BriefUsage | null;
  verdict: BriefVerdictInfo | null;
  isMutating: boolean;
  errorMessage: string | null;
  generate: () => void;
  regenerate: () => void;
}
