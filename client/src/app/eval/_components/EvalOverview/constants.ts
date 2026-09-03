/**
 * constants.ts — small UI copy fragments for EvalOverview (T12) that have no
 * home in `messages/en/eval.json`. That file's `dashboard.*`/`page.*` keys
 * (pre-seeded, then extended by T9 for `caseEditor.*`) cover the per-owner
 * detail vocabulary this page reuses; `messages/en/eval.json` itself is
 * owned by T9, not T12 (`docs/plans/eval-pipeline.md` T9 row), so the
 * handful of strings this page needs beyond what's already there (the
 * overview subtitle, the "Run all agents" control + its AC-43 confirmation
 * copy, and the AC-39 "Owner deleted" label) are kept as plain constants
 * here — same precedent `components/eval-tab/EvalsTab/constants.ts` set for
 * T11.
 */

/** AC-31 — page subtitle under the "Eval Dashboard" title. */
export const OVERVIEW_SUBTITLE = "Regression harness across all reviewer agents · pick an agent to see its runs";

/** AC-43 — "Run all agents" bulk-run control (workspace-wide, no owner filter). */
export const RUN_ALL_AGENTS_LABEL = "Run all agents";

/** AC-43 — confirmation dialog title shown before the bulk request fires. */
export const RUN_ALL_CONFIRM_TITLE = "Run all agents?";

/** AC-39 — shown in place of a row's owner name when its `owner_id` no
 *  longer resolves to a workspace agent/skill. */
export const OWNER_DELETED_LABEL = "Owner deleted";

/** Shown in a row's "Last run" slot when the owner has no persisted run yet. */
export const NEVER_RUN_LABEL = "Never run";

export const LOAD_ERROR_BODY = "Couldn't load the eval overview.";
export const EMPTY_TITLE = "No eval cases yet";
export const EMPTY_BODY = "Create an eval case for an agent or skill to start tracking regressions here.";

/**
 * AC-43 — confirmation copy names the number of eval cases the bulk run
 * will execute, framed as the (1:1) number of LLM calls it makes — each
 * case run is exactly one scored review call (`eval/service.ts`'s
 * `runCase`). `count` already excludes orphaned owners' cases
 * (`helpers.ts#totalRunnableCases`, AC-39).
 */
export function runAllConfirmMessage(count: number): string {
  const caseWord = count === 1 ? "eval case" : "eval cases";
  const callWord = count === 1 ? "LLM call" : "LLM calls";
  return `This runs ${count} ${caseWord} across every agent and skill — about ${count} ${callWord}. Continue?`;
}

/** "{passed}/{total} pass" — mirrors `EvalsTab`'s per-owner "Traces passed"
 *  metric (same `current.traces_passed`/`traces_total` fields), so the
 *  overview and the owner detail page agree on what "pass count" means. */
export function passCountLabel(passed: number, total: number): string {
  return `${passed}/${total} pass`;
}
