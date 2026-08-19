import { describe, expect, it } from 'vitest';
import { RunCache, type CachedRun } from '../src/runs/run-cache.js';

function makeEntry(overrides: Partial<CachedRun> = {}): CachedRun {
  return {
    repoId: 'repo-1',
    prId: 'pr-1',
    prNumber: 482,
    repoFullName: 'acme/payments-api',
    agentId: 'agent-1',
    agentName: 'Security Reviewer',
    ...overrides,
  };
}

describe('RunCache', () => {
  it('round-trips: remember() then lookup() returns the same data', () => {
    const cache = new RunCache();
    const entry = makeEntry();

    cache.remember('run-1', entry);

    expect(cache.lookup('run-1')).toEqual(entry);
  });

  it('a miss returns undefined and never throws', () => {
    const cache = new RunCache();

    expect(() => cache.lookup('unknown-run')).not.toThrow();
    expect(cache.lookup('unknown-run')).toBeUndefined();
  });

  it('evicts the oldest entry (FIFO) once the cap is exceeded', () => {
    const cache = new RunCache(3);

    cache.remember('run-1', makeEntry({ prNumber: 1 }));
    cache.remember('run-2', makeEntry({ prNumber: 2 }));
    cache.remember('run-3', makeEntry({ prNumber: 3 }));
    // Cap is 3; this fourth insert must evict the oldest ("run-1").
    cache.remember('run-4', makeEntry({ prNumber: 4 }));

    expect(cache.lookup('run-1')).toBeUndefined();
    expect(cache.lookup('run-2')).toEqual(makeEntry({ prNumber: 2 }));
    expect(cache.lookup('run-3')).toEqual(makeEntry({ prNumber: 3 }));
    expect(cache.lookup('run-4')).toEqual(makeEntry({ prNumber: 4 }));
    expect(cache.size).toBe(3);
  });

  it('overwriting an existing run_id does not evict another entry', () => {
    const cache = new RunCache(2);

    cache.remember('run-1', makeEntry({ prNumber: 1 }));
    cache.remember('run-2', makeEntry({ prNumber: 2 }));
    cache.remember('run-1', makeEntry({ prNumber: 100 }));

    expect(cache.size).toBe(2);
    expect(cache.lookup('run-1')).toEqual(makeEntry({ prNumber: 100 }));
    expect(cache.lookup('run-2')).toEqual(makeEntry({ prNumber: 2 }));
  });
});
