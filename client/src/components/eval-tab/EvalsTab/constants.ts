/**
 * constants.ts — small UI copy fragments for EvalsTab (T11) that have no
 * home in `messages/en/eval.json`. That file's `evalsTab.*`/`dashboard.*`
 * keys (already added by T9/earlier work) cover most of this tab's text and
 * are consumed via `useTranslations("eval")`; `messages/en/eval.json` itself
 * is owned by T9, not T11, so the handful of strings this tab needs beyond
 * what's already there (the "Run all evals" control, the AC-39 "Owner
 * deleted" label, the AC-42 link-a-skill hint, and the "Traces passed"
 * metric label) are kept as plain constants here instead.
 */

/** AC-20 — fourth metric strip label; no `dashboard.metrics.*` key exists
 *  for it (that block only has recall/precision/citationAccuracy). */
export const TRACES_PASSED_LABEL = "TRACES PASSED";

/** AC-23 — "Run all evals" bulk-run control. */
export const RUN_ALL_LABEL = "Run all evals";

/** AC-39 — shown on an orphaned case (and disables its row). */
export const OWNER_DELETED_LABEL = "Owner deleted";

/** AC-42 — shown, verbatim per the spec, when a skill's Evals tab has no
 *  enabled linked agent to run its cases through. */
export const LINK_AGENT_HINT = "Link this skill to an agent to run its evals.";

/** AC-45 — "N / M passing": `N` = passing cases, `M` = every case
 *  (never-run cases count toward `M` but neither passing nor failing). */
export function passCountLabel(passing: number, total: number): string {
  return `${passing} / ${total} passing`;
}

/** Header above the metric strip — matches the design reference's
 *  `screen_agents-evals-tab.jsx` "EVAL METRICS" section label. */
export const METRICS_HEADING = "EVAL METRICS";

/** Scoring explainer under the metric strip — verbatim per the design
 *  reference/mockup (`scorer.ts`'s own doc comment quotes the same line). */
export const SCORING_EXPLAINER = "Scoring is mechanical — a finding counts when file matches and line ranges overlap. No model call in the scorer.";

/** Link to the cross-owner Eval Dashboard (`/eval`) — top-right of the
 *  metric strip, per the design reference. */
export const VIEW_FULL_DASHBOARD_LABEL = "View full dashboard";

/** Case-kind badges — `must_find` (a positive case, from an accepted
 *  finding) vs `must_not_flag` (a negative case, from a dismissed one). */
export const MUST_FIND_LABEL = "MUST FIND";
export const MUST_NOT_FLAG_LABEL = "MUST NOT FLAG";

/** "expected N finding(s), got M" — the per-case detail line under the
 *  pass/fail state (only shown once a case has a latest run). */
export function expectedGotLabel(expected: number, got: number): string {
  return `expected ${expected} finding${expected === 1 ? "" : "s"}, got ${got}`;
}
