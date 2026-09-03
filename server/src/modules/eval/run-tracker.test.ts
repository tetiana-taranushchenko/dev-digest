import { describe, it, expect } from 'vitest';
import type { EvalRunResult } from '@devdigest/shared';
import { EvalRunInProgressError, EvalRunTracker, scopeKeyFor } from './run-tracker.js';

function makeResult(caseId: string): EvalRunResult {
  return {
    run_id: `run-${caseId}`,
    case_id: caseId,
    result: {
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      traces_passed: 1,
      traces_total: 1,
      duration_ms: 10,
      cost_usd: 0.01,
      per_trace: [],
    },
  };
}

describe('EvalRunTracker', () => {
  it('start() returns a batch id and rejects a second start() for the same scope key while one is running', () => {
    const tracker = new EvalRunTracker();
    const scopeKey = scopeKeyFor('agent', 'agent-1');

    const batchId = tracker.start(scopeKey, 2);
    expect(batchId).toBe(scopeKey);
    expect(tracker.status(batchId)).toEqual({
      total: 2,
      completed: 0,
      results: [],
      errors: [],
      status: 'running',
    });

    expect(() => tracker.start(scopeKey, 2)).toThrow(EvalRunInProgressError);

    // A different scope key is unaffected — no cross-owner blocking.
    const otherScopeKey = scopeKeyFor('agent', 'agent-2');
    expect(() => tracker.start(otherScopeKey, 1)).not.toThrow();
  });

  it('recordResult/recordError update progress incrementally and status() reports done only once every case has resolved', () => {
    const tracker = new EvalRunTracker();
    const scopeKey = scopeKeyFor('agent', 'agent-1');
    tracker.start(scopeKey, 3);

    tracker.recordResult(scopeKey, makeResult('case-1'));
    expect(tracker.status(scopeKey)).toMatchObject({ completed: 1, status: 'running' });

    tracker.recordError(scopeKey, 'case-2', 'LLM provider quota exceeded');
    expect(tracker.status(scopeKey)).toMatchObject({
      completed: 2,
      status: 'running',
      errors: [{ case_id: 'case-2', message: 'LLM provider quota exceeded' }],
    });

    // One case in the batch failed (AC-14) — the batch keeps running rather
    // than aborting, and a second start() while it's still in flight is
    // still rejected.
    expect(() => tracker.start(scopeKey, 3)).toThrow(EvalRunInProgressError);

    tracker.recordResult(scopeKey, makeResult('case-3'));
    const final = tracker.status(scopeKey);
    expect(final?.status).toBe('done');
    expect(final?.completed).toBe(3);
    expect(final?.results.map((r) => r.case_id)).toEqual(['case-1', 'case-3']);
    expect(final?.errors).toEqual([{ case_id: 'case-2', message: 'LLM provider quota exceeded' }]);

    // Batch finished — a subsequent start() for the same scope key succeeds again.
    expect(() => tracker.start(scopeKey, 1)).not.toThrow();
  });

  it('a batch with zero cases starts already done and status() returns undefined for an unknown batch id', () => {
    const tracker = new EvalRunTracker();
    const scopeKey = scopeKeyFor(null, null);

    const batchId = tracker.start(scopeKey, 0);
    expect(tracker.status(batchId)).toMatchObject({ total: 0, completed: 0, status: 'done' });

    expect(tracker.status('unknown-batch-id')).toBeUndefined();
  });
});
