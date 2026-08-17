/**
 * PR-list rollup helpers (`modules/pulls/status.ts`) — the pure derivation that
 * decides each PR's review STATUS and tallies its FINDINGS for the list. The DB
 * `status` column holds GitHub's merge state; the review status
 * (needs_review / reviewed / stale) is derived here from head vs lastReviewedSha
 * + age, so it gets unit coverage independent of the route's queries.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveReviewStatus,
  rollupSeverities,
  rankFindingsForPreview,
  latestPerAgent,
  STALE_DAYS,
} from '../src/modules/pulls/status.js';

const DAY = 86_400_000;
const now = Date.UTC(2026, 5, 11);

describe('deriveReviewStatus', () => {
  it('needs_review when never reviewed, or when head moved since the last review', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: null, headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'old', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('needs_review');
  });

  it('reviewed when the current head was reviewed and the PR is recent', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'open', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now - DAY), now }),
    ).toBe('reviewed');
  });

  it('stale when the current head was reviewed but the PR is older than STALE_DAYS', () => {
    expect(
      deriveReviewStatus({
        ghStatus: 'open',
        lastReviewedSha: 'abc',
        headSha: 'abc',
        updatedAt: new Date(now - (STALE_DAYS + 1) * DAY),
        now,
      }),
    ).toBe('stale');
  });

  it('keeps merged/closed regardless of review state', () => {
    expect(
      deriveReviewStatus({ ghStatus: 'merged', lastReviewedSha: null, headSha: 'abc', updatedAt: null, now }),
    ).toBe('merged');
    expect(
      deriveReviewStatus({ ghStatus: 'closed', lastReviewedSha: 'abc', headSha: 'abc', updatedAt: new Date(now), now }),
    ).toBe('closed');
  });
});

describe('rollupSeverities', () => {
  it('tallies findings into critical / warning / suggestion buckets (ignores unknown)', () => {
    expect(
      rollupSeverities([
        { severity: 'CRITICAL' },
        { severity: 'CRITICAL' },
        { severity: 'WARNING' },
        { severity: 'SUGGESTION' },
        { severity: 'WEIRD' },
      ]),
    ).toEqual({ critical: 2, warning: 1, suggestion: 1 });
  });

  it('is all-zero for no findings', () => {
    expect(rollupSeverities([])).toEqual({ critical: 0, warning: 0, suggestion: 0 });
  });
});

describe('rankFindingsForPreview', () => {
  const f = (severity: string, confidence: number) => ({ severity, confidence });

  it('sorts worst-severity first, then highest-confidence within the same severity', () => {
    expect(
      rankFindingsForPreview(
        [f('SUGGESTION', 0.9), f('CRITICAL', 0.6), f('CRITICAL', 0.95), f('WARNING', 0.8)],
        10,
      ),
    ).toEqual([f('CRITICAL', 0.95), f('CRITICAL', 0.6), f('WARNING', 0.8), f('SUGGESTION', 0.9)]);
  });

  it('caps the result to `limit`, keeping the worst/highest-confidence ones', () => {
    const rows = [f('SUGGESTION', 0.5), f('CRITICAL', 0.5), f('WARNING', 0.5), f('CRITICAL', 0.9)];
    expect(rankFindingsForPreview(rows, 2)).toEqual([f('CRITICAL', 0.9), f('CRITICAL', 0.5)]);
  });

  it('does not mutate the input array', () => {
    const rows = [f('WARNING', 0.5), f('CRITICAL', 0.9)];
    const copy = [...rows];
    rankFindingsForPreview(rows, 10);
    expect(rows).toEqual(copy);
  });

  it('is empty for no findings', () => {
    expect(rankFindingsForPreview([], 5)).toEqual([]);
  });
});

describe('latestPerAgent', () => {
  it('keeps each agent latest review, preserves the first equal-time row, and leaves null-agent reviews independent', () => {
    const rows = [
      { id: 'agent-a-first', prId: 'pr-1', agentId: 'agent-a', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'agent-a-equal', prId: 'pr-1', agentId: 'agent-a', createdAt: '2026-01-02T00:00:00Z' },
      { id: 'agent-b-old', prId: 'pr-1', agentId: 'agent-b', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'agent-b-new', prId: 'pr-1', agentId: 'agent-b', createdAt: '2026-01-03T00:00:00Z' },
      { id: 'legacy-a', prId: 'pr-1', agentId: null, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'legacy-b', prId: 'pr-1', agentId: null, createdAt: '2026-01-03T00:00:00Z' },
    ];

    expect([...latestPerAgent(rows)]).toEqual([
      'agent-a-first',
      'agent-b-new',
      'legacy-a',
      'legacy-b',
    ]);
  });
});
