import type { EvalRunResult } from '@devdigest/shared';

/**
 * Bulk eval run tracker — process-local adapter (T4), not DB-backed.
 *
 * `eval_runs` has no `status` column (AC-36 forbids adding one), and
 * `JobRunner`/`jobs` is deliberately not reused here (see the plan's
 * Implementation Recommendations #2) — AC-47 names the `reviews`-module
 * fire-and-forget pattern as the precedent to follow instead. This tracker is
 * a small in-process `Map` mirroring `platform/sse.ts`'s `runBus` in spirit,
 * far simpler: no SSE, just poll-a-status-object.
 *
 * A batch is keyed by "scope key" — `` `${owner_kind ?? 'workspace'}:${owner_id
 * ?? 'all'}` `` (`scopeKeyFor` below) — and that same scope key doubles as the
 * batch id returned to the client for polling (`GET
 * /eval-cases/run-all/:batchId`), since only one batch can be `running` for a
 * given scope at a time (AC-15).
 *
 * Not persisted — a server restart mid-batch simply loses progress. Acceptable
 * because no `eval_runs` row is ever half-written: each case's row is inserted
 * only on that case's own success (T5's `runCase`/`runBulk`).
 */

/** One case's failure inside a bulk run (AC-14) — the batch continues. */
export interface EvalBatchError {
  case_id: string;
  message: string;
}

/** In-flight (or just-finished) state of one bulk run batch. */
export interface EvalBatchState {
  total: number;
  completed: number;
  results: EvalRunResult[];
  errors: EvalBatchError[];
  status: 'running' | 'done';
}

/**
 * Thrown by `start()` when a batch is already `running` for the same scope
 * key (AC-15's server-side guard). `eval/service.ts` (T5) maps this to a
 * `ConflictError` (409).
 */
export class EvalRunInProgressError extends Error {
  constructor(public readonly scopeKey: string) {
    super(`An eval run is already in progress for "${scopeKey}"`);
    this.name = 'EvalRunInProgressError';
  }
}

/** Builds the scope key a bulk run's owner filter maps to (Implementation Recommendations #2). */
export function scopeKeyFor(ownerKind?: string | null, ownerId?: string | null): string {
  return `${ownerKind ?? 'workspace'}:${ownerId ?? 'all'}`;
}

export class EvalRunTracker {
  private readonly batches = new Map<string, EvalBatchState>();

  /**
   * Registers a new batch for `scopeKey` and returns the batch id (the scope
   * key itself). Throws `EvalRunInProgressError` if a batch for the same
   * scope key is currently `running` (AC-15) — the caller never starts a
   * second concurrent bulk run for one owner.
   *
   * A batch with `total === 0` (no cases to run) starts already `done`, so
   * callers never poll a batch that can never complete.
   */
  start(scopeKey: string, total: number): string {
    const existing = this.batches.get(scopeKey);
    if (existing && existing.status === 'running') {
      throw new EvalRunInProgressError(scopeKey);
    }
    this.batches.set(scopeKey, {
      total,
      completed: 0,
      results: [],
      errors: [],
      status: total > 0 ? 'running' : 'done',
    });
    return scopeKey;
  }

  /** Records one case's successful run result, advancing the batch's progress. */
  recordResult(scopeKey: string, result: EvalRunResult): void {
    const batch = this.requireBatch(scopeKey);
    batch.results.push(result);
    this.advance(batch);
  }

  /** Records one case's failure (AC-14) — the batch continues, never aborts. */
  recordError(scopeKey: string, caseId: string, message: string): void {
    const batch = this.requireBatch(scopeKey);
    batch.errors.push({ case_id: caseId, message });
    this.advance(batch);
  }

  /** Current status of a batch, or `undefined` if none was ever started for this id. */
  status(batchId: string): EvalBatchState | undefined {
    return this.batches.get(batchId);
  }

  private advance(batch: EvalBatchState): void {
    batch.completed += 1;
    if (batch.completed >= batch.total) batch.status = 'done';
  }

  private requireBatch(scopeKey: string): EvalBatchState {
    const batch = this.batches.get(scopeKey);
    if (!batch) {
      throw new Error(`No eval run batch found for scope "${scopeKey}"`);
    }
    return batch;
  }
}
