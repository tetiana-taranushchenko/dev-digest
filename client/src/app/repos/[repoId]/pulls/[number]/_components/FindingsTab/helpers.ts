import type { FindingRecord, ReviewRecord } from "@devdigest/shared";

/**
 * Flattens every review run's findings into one list (for the severity
 * counters), and separately indexes them by `run_id` (for the Timeline's
 * per-run hover popup, since its own row data — RunSummary — carries only
 * denormalized counts, not the findings themselves). Runs without a
 * `run_id` contribute to the flat list but have no Timeline entry to key.
 */
export function groupFindingsByRun(runs: ReviewRecord[]): {
  allFindings: FindingRecord[];
  findingsByRunId: Map<string, FindingRecord[]>;
} {
  const findingsByRunId = new Map<string, FindingRecord[]>();
  const allFindings: FindingRecord[] = [];
  for (const review of runs) {
    if (review.run_id) findingsByRunId.set(review.run_id, review.findings);
    allFindings.push(...review.findings);
  }
  return { allFindings, findingsByRunId };
}
