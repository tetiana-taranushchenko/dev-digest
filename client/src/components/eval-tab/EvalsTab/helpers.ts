/** helpers.ts — pure data-shaping helpers for EvalsTab (T11). No server
 *  calls, no React — cross-references the cases/dashboard data the tab
 *  already fetched, mirroring `EvalCaseEditor/helpers.ts`'s shape
 *  (`../../eval-case-editor/EvalCaseEditor/helpers.ts`). */

import type { Agent, EvalCase, EvalCaseInput, EvalOwnerKind, EvalRunRecord, Skill } from "@devdigest/shared";

/**
 * AC-39 — true when `ownerId` no longer resolves to a workspace agent/skill.
 * Every case in a given `EvalsTab` shares the tab's own `ownerKind`/`ownerId`
 * (the case list is fetched pre-filtered to this owner), so one owner-level
 * check applies uniformly to every row — there's no per-case divergence to
 * cross-reference separately.
 */
export function isOrphanOwner(
  ownerKind: EvalOwnerKind,
  ownerId: string,
  agents: Agent[],
  skills: Skill[],
): boolean {
  const pool = ownerKind === "agent" ? agents : skills;
  return !pool.some((o) => o.id === ownerId);
}

/** `EvalDashboard.recent_runs` is already most-recent-first
 *  (`server/src/modules/eval/dashboard.ts:200-203`) — the first match for a
 *  case id is its latest run. */
export function latestRunForCase(caseId: string, recentRuns: EvalRunRecord[]): EvalRunRecord | undefined {
  return recentRuns.find((run) => run.case_id === caseId);
}

export type CaseState = "passing" | "failing" | "never-run";

/** AC-21 — a case with no persisted run (or a run whose `pass` wasn't
 *  scored) is "never run"; otherwise its latest run's `pass` decides
 *  passing vs failing. Every case renders in exactly one of these states. */
export function caseStateOf(run: EvalRunRecord | undefined): CaseState {
  if (!run || run.pass == null) return "never-run";
  return run.pass ? "passing" : "failing";
}

/** AC-45 — `total` (`M`) is every case belonging to the owner, including
 *  never-run ones; never-run cases count toward `total` but neither
 *  `passing` nor `failing`. */
export function computePassCounts(
  cases: EvalCase[],
  recentRuns: EvalRunRecord[],
): { passing: number; failing: number; total: number } {
  let passing = 0;
  let failing = 0;
  for (const evalCase of cases) {
    const state = caseStateOf(latestRunForCase(evalCase.id, recentRuns));
    if (state === "passing") passing += 1;
    else if (state === "failing") failing += 1;
  }
  return { passing, failing, total: cases.length };
}

/** AC-24 — "New eval case" draft pre-scoped to the tab's owner, so
 *  `EvalCaseEditor`'s owner picker never shows (unlike the ownerless seed
 *  "Turn into eval case" produces, T10). */
export function newCaseSeed(ownerKind: EvalOwnerKind, ownerId: string): EvalCaseInput {
  return {
    owner_kind: ownerKind,
    owner_id: ownerId,
    name: "",
    input_diff: "",
    expected_output: [],
  };
}
