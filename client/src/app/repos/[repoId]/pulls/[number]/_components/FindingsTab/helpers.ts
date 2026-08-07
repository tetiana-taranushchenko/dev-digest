import type { FindingRecord, ReviewRecord } from "@devdigest/shared";

/**
 * Splits review runs into two views:
 *  - `findingsByRunId` — every run's OWN findings, keyed by `run_id`, for the
 *    Timeline's per-run hover popup (its row data — RunSummary — carries only
 *    denormalized counts, not the findings themselves). Runs without a
 *    `run_id` have no Timeline entry to key.
 *  - `allFindings` — the PR-wide severity counters' source list. Only each
 *    agent's LATEST review contributes here: without this, an old finding
 *    that a later re-run of the same agent no longer flags would keep
 *    inflating the totals forever as the PR gets pushed to and re-reviewed.
 */
export function groupFindingsByRun(runs: ReviewRecord[]): {
  allFindings: FindingRecord[];
  findingsByRunId: Map<string, FindingRecord[]>;
} {
  const findingsByRunId = new Map<string, FindingRecord[]>();
  for (const review of runs) {
    if (review.run_id) findingsByRunId.set(review.run_id, review.findings);
  }

  // Runs without an agent_id (shouldn't normally happen) each count as their
  // own "agent" via review.id, so they're never silently merged/dropped.
  const latestByAgent = new Map<string, ReviewRecord>();
  for (const review of runs) {
    const key = review.agent_id ?? review.id;
    const current = latestByAgent.get(key);
    if (!current || Date.parse(review.created_at) > Date.parse(current.created_at)) {
      latestByAgent.set(key, review);
    }
  }
  const allFindings = [...latestByAgent.values()].flatMap((review) => review.findings);

  return { allFindings, findingsByRunId };
}
