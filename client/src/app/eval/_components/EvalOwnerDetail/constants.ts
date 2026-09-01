/**
 * constants.ts — small UI copy fragments for EvalOwnerDetail (T13) that have
 * no home in `messages/en/eval.json`. That file's `dashboard.*` keys
 * (`metricTrend`, `recentRuns`, `legend.*`, `table.*`, `noRuns`, `pass`,
 * `fail`, `metrics.*`) were pre-seeded for exactly this owner-detail view
 * (see `EvalOverview/constants.ts`'s own comment: "cover the per-owner
 * detail vocabulary this page reuses"). `messages/en/eval.json` is T9's
 * owned path, not this task's, so the handful of strings still missing —
 * the back link, the AC-33 compare hint/button, the AC-46 version column —
 * are kept as plain constants here, same precedent `EvalOverview/constants.ts`
 * (T12) and `EvalsTab/constants.ts` (T11) set.
 */

/** Back-to-overview control shown above the owner detail header. */
export const BACK_LABEL = "All agents";

/** AC-33 — enabled only once exactly two runs are selected. */
export const COMPARE_LABEL = "Compare";

/** AC-33 — shown in place of a selection count while fewer than two runs
 *  are selected. */
export const SELECT_TWO_HINT = "Select two runs to compare";

/** AC-46 — shown in a run row's version cell when no agent-version
 *  snapshot qualifies (the run predates every known version, or none
 *  could be resolved for a skill owner with no enabled linked agent). */
export const NO_VERSION_LABEL = "—";

/** AC-46 — recent-runs table's version column header (no equivalent key
 *  in `dashboard.table.*`, which predates this per-run inference). */
export const VERSION_COLUMN_LABEL = "Version";

export const LOAD_ERROR_BODY = "Couldn't load this owner's eval detail.";

/** "{count} selected" — shown once at least one run is selected, replacing
 *  `SELECT_TWO_HINT` (AC-33). */
export function selectedCountLabel(count: number): string {
  return `${count} selected`;
}
