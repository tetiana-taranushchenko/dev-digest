import { describe, it, expect } from 'vitest';
import type { DashboardRunRow } from './repository.js';
import { buildDashboard } from './dashboard.js';

let nextId = 0;

function makeRow(overrides: Partial<DashboardRunRow> & Pick<DashboardRunRow, 'case_id' | 'ran_at'>): DashboardRunRow {
  nextId += 1;
  return {
    id: `run-${nextId}`,
    case_name: 'A case',
    pass: null,
    recall: null,
    precision: null,
    citation_accuracy: null,
    duration_ms: null,
    cost_usd: null,
    actual_output: null,
    ...overrides,
  };
}

describe('dashboard', () => {
  it('builds one trend point per distinct ran_at from latest-per-case state', () => {
    const rows = [
      makeRow({ case_id: 'a', ran_at: 't1', recall: 1, precision: 1, citation_accuracy: 1, pass: true }),
      makeRow({ case_id: 'b', ran_at: 't1', recall: 0, precision: 0, citation_accuracy: null, pass: false }),
      makeRow({ case_id: 'a', ran_at: 't2', recall: 0.5, precision: 0.5, citation_accuracy: 0.5, pass: false }),
    ];

    const dashboard = buildDashboard(rows, 2, null, null);

    expect(dashboard.trend).toHaveLength(2);
    expect(dashboard.trend[0]!.ran_at).toBe('t1');
    expect(dashboard.trend[0]!.recall).toBe(0.5); // mean(1, 0)
    expect(dashboard.trend[0]!.precision).toBe(0.5);
    expect(dashboard.trend[0]!.pass_rate).toBe(0.5);

    // t2's snapshot uses case a's updated row and case b's still-latest row.
    expect(dashboard.trend[1]!.ran_at).toBe('t2');
    expect(dashboard.trend[1]!.recall).toBe(0.25); // mean(0.5, 0)
    expect(dashboard.trend[1]!.precision).toBe(0.25);
    expect(dashboard.trend[1]!.pass_rate).toBe(0); // both false at t2
  });

  it('delta is current minus the preceding trend point', () => {
    const rows = [
      makeRow({ case_id: 'a', ran_at: 't1', recall: 1, precision: 1, citation_accuracy: 1, pass: true }),
      makeRow({ case_id: 'a', ran_at: 't2', recall: 0.5, precision: 0.5, citation_accuracy: 0.5, pass: false }),
    ];

    const dashboard = buildDashboard(rows, 1, null, null);

    expect(dashboard.current.recall).toBe(0.5);
    expect(dashboard.delta.recall).toBeCloseTo(0.5 - 1, 10);
    expect(dashboard.delta.precision).toBeCloseTo(0.5 - 1, 10);
    expect(dashboard.delta.citation_accuracy).toBeCloseTo(0.5 - 1, 10);

    // Single trend point (no preceding point) zeroes the delta.
    const singlePoint = buildDashboard([rows[0]!], 1, null, null);
    expect(singlePoint.delta).toEqual({ recall: 0, precision: 0, citation_accuracy: 0 });
  });

  it('zero runs yields a well-formed zeroed dashboard, not an error', () => {
    const dashboard = buildDashboard([], 5, 'agent', 'agent-1');

    expect(dashboard).toEqual({
      owner_kind: 'agent',
      owner_id: 'agent-1',
      cases_total: 5,
      current: {
        recall: 0,
        precision: 0,
        citation_accuracy: 0,
        traces_passed: 0,
        traces_total: 0,
        cost_usd: null,
      },
      delta: { recall: 0, precision: 0, citation_accuracy: 0 },
      trend: [],
      recent_runs: [],
      alert: null,
    });
  });

  it('alert names the worst regressed metric past a 5pt threshold; null otherwise', () => {
    const regressed = buildDashboard(
      [
        makeRow({ case_id: 'a', ran_at: 't1', recall: 1, precision: 1, citation_accuracy: 1, pass: true }),
        makeRow({ case_id: 'a', ran_at: 't2', recall: 0.5, precision: 1, citation_accuracy: 1, pass: false }),
      ],
      1,
      null,
      null,
    );
    expect(regressed.alert).toBe('Recall dropped 50pt (100% → 50%)');

    const withinNoise = buildDashboard(
      [
        makeRow({ case_id: 'a', ran_at: 't1', recall: 1, precision: 1, citation_accuracy: 1, pass: true }),
        makeRow({ case_id: 'a', ran_at: 't2', recall: 0.99, precision: 1, citation_accuracy: 1, pass: true }),
      ],
      1,
      null,
      null,
    );
    expect(withinNoise.alert).toBeNull();

    const singlePoint = buildDashboard(
      [makeRow({ case_id: 'a', ran_at: 't1', recall: 0, precision: 0, citation_accuracy: 0, pass: false })],
      1,
      null,
      null,
    );
    expect(singlePoint.alert).toBeNull();
  });

  it('citation_accuracy averages only non-null per-case values, defaulting to 1 when none exist', () => {
    const mixed = buildDashboard(
      [
        makeRow({ case_id: 'a', ran_at: 't1', citation_accuracy: 0.8 }),
        makeRow({ case_id: 'b', ran_at: 't1', citation_accuracy: null }),
        makeRow({ case_id: 'c', ran_at: 't1', citation_accuracy: 0.6 }),
      ],
      3,
      null,
      null,
    );
    expect(mixed.trend[0]!.citation_accuracy).toBeCloseTo(0.7, 10); // mean(0.8, 0.6)
    expect(mixed.current.citation_accuracy).toBeCloseTo(0.7, 10);

    const allNull = buildDashboard(
      [
        makeRow({ case_id: 'a', ran_at: 't1', citation_accuracy: null }),
        makeRow({ case_id: 'b', ran_at: 't1', citation_accuracy: null }),
      ],
      2,
      null,
      null,
    );
    expect(allNull.trend[0]!.citation_accuracy).toBe(1);
    expect(allNull.current.citation_accuracy).toBe(1);
  });

  it('recent_runs is the N most recent EvalRunRecord rows, most-recent-first, with no batch grouping', () => {
    // Two runs sharing the exact same ran_at collapse into one trend point,
    // but must still both appear as distinct recent_runs entries.
    const sameTimestamp = buildDashboard(
      [
        makeRow({ id: 'run-a', case_id: 'a', ran_at: 't1' }),
        makeRow({ id: 'run-b', case_id: 'b', ran_at: 't1' }),
        makeRow({ id: 'run-c', case_id: 'a', ran_at: 't2' }),
      ],
      2,
      null,
      null,
    );
    expect(sameTimestamp.trend).toHaveLength(2); // grouped for the trend
    expect(sameTimestamp.recent_runs).toHaveLength(3); // not grouped for recent_runs
    expect(sameTimestamp.recent_runs.map((r) => r.id)).toEqual(
      expect.arrayContaining(['run-a', 'run-b', 'run-c']),
    );
    expect(sameTimestamp.recent_runs[0]!.id).toBe('run-c'); // most recent first

    // Cap at 20, most-recent-first.
    const manyRows = Array.from({ length: 25 }, (_, idx) =>
      makeRow({ id: `run-${idx}`, case_id: `case-${idx}`, ran_at: `2026-01-${String(idx + 1).padStart(2, '0')}` }),
    );
    const capped = buildDashboard(manyRows, 25, null, null);
    expect(capped.recent_runs).toHaveLength(20);
    expect(capped.recent_runs[0]!.id).toBe('run-24');
    expect(capped.recent_runs[19]!.id).toBe('run-5');
  });
});
