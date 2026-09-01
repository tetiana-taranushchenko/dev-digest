/**
 * constants.ts — small UI copy fragments for CompareRunsModal (T14). Same
 * "no home in `messages/en/eval.json`" precedent
 * `EvalOwnerDetail/constants.ts` (T13) and `EvalOverview/constants.ts`
 * (T12) set — `messages/en/eval.json` isn't this task's owned path either.
 */

export const CLOSE_LABEL = "Close";
export const SYSTEM_PROMPT_DIFF_LABEL = "System prompt diff";
export const NO_SNAPSHOT_MESSAGE = "No matching agent version snapshot found for one of these runs.";
export const PROMOTING_LABEL = "Promoting…";

export const COMPARE_SUBTITLE = "Old prompt vs new — metric deltas and system-prompt diff for the two selected runs";

export function compareTitle(oldVersion: number | undefined, newVersion: number | undefined): string {
  if (oldVersion == null || newVersion == null) return "Compare runs";
  return `Compare runs · v${oldVersion} → v${newVersion}`;
}

export function versionLegend(version: number | undefined, side: "old" | "new"): string {
  return `v${version ?? "?"} (${side})`;
}

export function promoteLabel(version: number | undefined): string {
  return version == null ? "Promote" : `Promote v${version}`;
}

export const PROMOTE_CONFIRM_TITLE = "Promote this version?";

export function promoteConfirmMessage(version: number | undefined): string {
  return `This makes v${version ?? "?"}'s config the agent's current settings, including its linked skills.`;
}

export function promoteSuccessMessage(version: number | undefined): string {
  return `Promoted v${version ?? "?"} to current.`;
}

export const METRIC_LABELS = {
  recall: "Recall",
  precision: "Precision",
  citation: "Citation",
  cost: "Cost",
} as const;
