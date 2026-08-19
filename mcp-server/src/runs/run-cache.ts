// In-memory, process-lifetime cache mapping a `run_id` back to the
// identifiers needed to look it up again (`repoId`, `prId`, `prNumber`,
// `repoFullName`, `agentId`, `agentName`).
//
// Why this exists at all: `devdigest_run_agent_on_pr` records the run here
// *before* it starts polling (Behaviour spec, step 6), so that even if the
// poll loop times out, the caller still has a `run_id` it can hand to
// `devdigest_get_findings` to pick the result up later in the same process.
//
// Why it is process-lifetime only, and why that is fine: this package is a
// pure HTTP client with no database and no persistence layer of its own
// (REQ-3/REQ-4) — a `Map` living only as long as this Node process is the
// only kind of cache available to it, and there is no backend endpoint that
// resolves a review by `run_id` alone (`GET /pulls/:id/runs` and
// `GET /pulls/:id/reviews` are both PR-scoped; `GET /runs/:id/trace` returns
// prompt/tool-call trace data, not verdict/findings — see the plan's
// Behaviour specifications, `devdigest_get_findings` Path A). So a server
// restart, or simply a `run_id` from a previous process, is *always* an
// unrecoverable cache miss here, by construction, not as a bug.
//
// This is precisely why `devdigest_get_findings` Path B (`repo` + `pr`,
// looking up the PR's most recent run via `GET /pulls/:id/runs`) exists: it
// needs no cache at all. A `lookup()` miss is therefore always recoverable —
// the caller can retry the same tool with `repo` + `pr` instead of `run_id`,
// or re-run `devdigest_run_agent_on_pr`. This module has no opinion on that
// recovery message; it only ever returns `undefined` on a miss, never
// throws — the caller (T9's `devdigest_get_findings` handler) owns the
// actionable wording (REQ-8).
//
// Bounded size: a long-lived server process must not grow this `Map`
// without limit, so it is capped at `MAX_ENTRIES` with FIFO eviction — the
// oldest `remember()`ed entry is dropped first once the cap is exceeded.
// `Map` iteration order is insertion order, which is what makes a plain
// `Map` sufficient for FIFO without a separate queue.

/** The identifiers needed to recover a `run_id`'s PR/agent context later. */
export interface CachedRun {
  repoId: string;
  prId: string;
  prNumber: number;
  repoFullName: string;
  agentId: string;
  agentName: string;
}

/** Maximum number of runs retained before the oldest is evicted (FIFO). */
export const MAX_ENTRIES = 500;

export class RunCache {
  private readonly entries = new Map<string, CachedRun>();

  constructor(private readonly maxEntries: number = MAX_ENTRIES) {}

  /**
   * Records `runId`'s context, evicting the oldest entry first if this
   * insertion would exceed `maxEntries`. Overwriting an existing `runId`
   * does not itself count as growth (the entry count does not change), but
   * it does refresh insertion order in the underlying `Map`.
   */
  remember(runId: string, entry: CachedRun): void {
    if (!this.entries.has(runId) && this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
    this.entries.set(runId, entry);
  }

  /** Returns the cached entry for `runId`, or `undefined` on a miss. Never throws. */
  lookup(runId: string): CachedRun | undefined {
    return this.entries.get(runId);
  }

  /** Current number of cached entries. Exposed for tests only. */
  get size(): number {
    return this.entries.size;
  }
}
