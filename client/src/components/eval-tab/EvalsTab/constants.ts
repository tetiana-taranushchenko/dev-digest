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
