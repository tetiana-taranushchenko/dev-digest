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

// ===========================================================================
// Case-kind / display-name / produced-count — read-only derivations over the
// same `expected_output`/`actual_output` shapes `scorer.ts` (server) already
// defines (`ExpectedFinding[]`, `{ produced: Finding[] }`). Kept `unknown`-safe
// here since the client contract types both fields as `z.unknown()`.
// ===========================================================================

interface ExpectedFindingLike {
  file?: unknown;
  start_line?: unknown;
  end_line?: unknown;
  title?: unknown;
  severity?: unknown;
  category?: unknown;
}

/** Safe parse of a case's `expected_output` — `[]` for anything that isn't a
 *  JSON array (never throws; scoring's own validation is the source of
 *  truth for whether a case is runnable at all). */
export function parseExpectedFindings(evalCase: Pick<EvalCase, "expected_output">): ExpectedFindingLike[] {
  return Array.isArray(evalCase.expected_output) ? (evalCase.expected_output as ExpectedFindingLike[]) : [];
}

export type EvalCaseKind = "must_find" | "must_not_flag";

/** A case's `expected_output` empty ⇒ negative (`must_not_flag`, a dismissed
 *  finding); non-empty ⇒ positive (`must_find`) — mirrors the server's own
 *  seeding split (`server/src/modules/eval/helpers.ts`'s
 *  `buildExpectedOutputFromFinding`), re-derived here since the client only
 *  gets the resulting JSON, not the original `dismissedAt` flag. */
export function caseKindOf(evalCase: Pick<EvalCase, "expected_output">): EvalCaseKind {
  return parseExpectedFindings(evalCase).length > 0 ? "must_find" : "must_not_flag";
}

/** Best-effort human label for a seeded case: prefer the finding `title`
 *  carried in `expected_output[0]` (exact, `must_find` cases only — see
 *  `buildExpectedOutputFromFinding`); otherwise de-slugify the seeded
 *  `must-find-`/`no-` name. Falls back to the raw name for a manually
 *  authored case (no recognizable seed prefix). */
export function caseDisplayName(evalCase: Pick<EvalCase, "name" | "expected_output">): string {
  const [first] = parseExpectedFindings(evalCase);
  if (typeof first?.title === "string" && first.title.length > 0) {
    return `From finding: ${first.title}`;
  }
  const deslugged = evalCase.name.match(/^(?:must-find|no)-(.+)$/);
  if (!deslugged) return evalCase.name;
  const words = deslugged[1]!.replace(/-/g, " ");
  return `From finding: ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** Number of findings a run actually produced — reads
 *  `EvalActualOutput.produced` (`server/src/modules/eval/scorer.ts`'s
 *  `buildActualOutput`) defensively, since the client contract types
 *  `actual_output` as `z.unknown()` and a never-run case has `null` here. */
export function producedCountOf(run: EvalRunRecord | undefined): number | undefined {
  const produced = (run?.actual_output as { produced?: unknown } | null | undefined)?.produced;
  return Array.isArray(produced) ? produced.length : undefined;
}
