import type { EvalDashboard, EvalOwnerKind, EvalPerTrace, EvalRunRecord, EvalTrendPoint } from '@devdigest/shared';
import type { DashboardRunRow } from './repository.js';
import type { EvalActualOutput } from './scorer.js';

/**
 * Eval dashboard aggregation — pure domain logic (`modules/eval/dashboard.ts`,
 * T3). No I/O, no `Container` — takes the rows `eval/repository.ts` (T1)
 * already read and folds them into the frozen `EvalDashboard` shape
 * (`vendor/shared/contracts/eval-ci.ts:68-89`). See the plan's T3 notes for
 * the exact algorithm this implements step by step.
 */

/** Last N runs surfaced on the dashboard (`EvalDashboard.recent_runs`). */
const EVAL_RECENT_RUNS_LIMIT = 20;

/** Regression past this magnitude (5 percentage points) triggers `alert`. */
const ALERT_THRESHOLD = 0.05;

type SnapshotMetrics = Omit<EvalTrendPoint, 'ran_at'>;

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Aggregate one snapshot of "each case's latest known state as of this
 * ran_at" into one trend point's metrics. `rows` is always non-empty when
 * called (a snapshot is only taken after at least one row has been added to
 * `latestByCase`).
 */
function aggregateSnapshot(rows: DashboardRunRow[]): SnapshotMetrics {
  const recall = mean(rows.map((r) => r.recall ?? 0));
  const precision = mean(rows.map((r) => r.precision ?? 0));

  const nonNullCitation = rows
    .map((r) => r.citation_accuracy)
    .filter((v): v is number => v !== null);
  const citation_accuracy = nonNullCitation.length > 0 ? mean(nonNullCitation) : 1;

  const passCount = rows.filter((r) => r.pass === true).length;
  const pass_rate = passCount / rows.length;

  const costs = rows.map((r) => r.cost_usd).filter((v): v is number => v !== null);
  const cost_usd = costs.length > 0 ? costs.reduce((sum, c) => sum + c, 0) : null;

  return { recall, precision, citation_accuracy, pass_rate, cost_usd };
}

/** Read `per_trace` out of a stored run's `actual_output` (jsonb, `unknown`). */
function perTraceOf(actualOutput: unknown): EvalPerTrace[] {
  if (
    actualOutput &&
    typeof actualOutput === 'object' &&
    Array.isArray((actualOutput as Partial<EvalActualOutput>).per_trace)
  ) {
    return (actualOutput as EvalActualOutput).per_trace;
  }
  return [];
}

function sumTraces(rows: DashboardRunRow[]): { traces_passed: number; traces_total: number } {
  let traces_passed = 0;
  let traces_total = 0;
  for (const row of rows) {
    const perTrace = perTraceOf(row.actual_output);
    traces_total += perTrace.length;
    traces_passed += perTrace.filter((t) => t.pass).length;
  }
  return { traces_passed, traces_total };
}

function toRunRecord(row: DashboardRunRow): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.case_id,
    case_name: row.case_name,
    ran_at: row.ran_at,
    actual_output: row.actual_output,
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citation_accuracy,
    duration_ms: row.duration_ms,
    cost_usd: row.cost_usd,
  };
}

const METRIC_LABELS = {
  recall: 'Recall',
  precision: 'Precision',
  citation_accuracy: 'Citation accuracy',
} as const;

type AlertMetric = keyof typeof METRIC_LABELS;

/**
 * `null` if fewer than two trend points exist; otherwise the worst
 * (most-negative) regression across recall/precision/citation_accuracy
 * between the last two trend points, formatted as a message when it exceeds
 * `ALERT_THRESHOLD`, else `null`.
 */
function buildAlert(trend: EvalTrendPoint[]): string | null {
  if (trend.length < 2) return null;
  const curr = trend[trend.length - 1]!;
  const prev = trend[trend.length - 2]!;

  let worstMetric: AlertMetric | null = null;
  let worstDelta = 0;
  for (const metric of Object.keys(METRIC_LABELS) as AlertMetric[]) {
    const delta = curr[metric] - prev[metric];
    if (worstMetric === null || delta < worstDelta) {
      worstMetric = metric;
      worstDelta = delta;
    }
  }

  if (worstMetric === null || worstDelta >= -ALERT_THRESHOLD) return null;

  const label = METRIC_LABELS[worstMetric];
  const points = Math.round(-worstDelta * 100);
  const prevPct = Math.round(prev[worstMetric] * 100);
  const currPct = Math.round(curr[worstMetric] * 100);
  return `${label} dropped ${points}pt (${prevPct}% → ${currPct}%)`;
}

/**
 * Fold a scope's runs (already ordered by `ran_at` ASC by the repository,
 * re-sorted here defensively since this function is unit-tested standalone)
 * into the `EvalDashboard` shape. See the plan's T3 notes for the exact
 * 8-step algorithm this follows.
 */
export function buildDashboard(
  rows: DashboardRunRow[],
  casesTotal: number,
  ownerKind: EvalOwnerKind | null,
  ownerId: string | null,
): EvalDashboard {
  const sorted = [...rows].sort((a, b) => new Date(a.ran_at).getTime() - new Date(b.ran_at).getTime());

  // Step 2-3: walk rows, snapshot latestByCase once per distinct ran_at.
  const latestByCase = new Map<string, DashboardRunRow>();
  const trend: EvalTrendPoint[] = [];

  let i = 0;
  while (i < sorted.length) {
    const ranAt = sorted[i]!.ran_at;
    while (i < sorted.length && sorted[i]!.ran_at === ranAt) {
      const row = sorted[i]!;
      latestByCase.set(row.case_id, row);
      i += 1;
    }
    const snapshotRows = [...latestByCase.values()];
    trend.push({ ran_at: ranAt, ...aggregateSnapshot(snapshotRows) });
  }

  // Step 8: zero-run input — well-formed zeroed dashboard, not an error.
  if (trend.length === 0) {
    return {
      owner_kind: ownerKind,
      owner_id: ownerId,
      cases_total: casesTotal,
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
    };
  }

  // Step 4: current = last trend point's aggregate + summed traces.
  const lastPoint = trend[trend.length - 1]!;
  const { traces_passed, traces_total } = sumTraces([...latestByCase.values()]);
  const current = {
    recall: lastPoint.recall,
    precision: lastPoint.precision,
    citation_accuracy: lastPoint.citation_accuracy,
    traces_passed,
    traces_total,
    cost_usd: lastPoint.cost_usd,
  };

  // Step 5: delta = current minus the preceding trend point (zeroed if < 2 points).
  const prevPoint = trend.length >= 2 ? trend[trend.length - 2]! : null;
  const delta = prevPoint
    ? {
        recall: current.recall - prevPoint.recall,
        precision: current.precision - prevPoint.precision,
        citation_accuracy: current.citation_accuracy - prevPoint.citation_accuracy,
      }
    : { recall: 0, precision: 0, citation_accuracy: 0 };

  // Step 6: recent_runs — last N rows, most-recent-first, no batch grouping.
  const recent_runs = sorted
    .slice(Math.max(0, sorted.length - EVAL_RECENT_RUNS_LIMIT))
    .reverse()
    .map(toRunRecord);

  // Step 7: alert.
  const alert = buildAlert(trend);

  return {
    owner_kind: ownerKind,
    owner_id: ownerId,
    cases_total: casesTotal,
    current,
    delta,
    trend,
    recent_runs,
    alert,
  };
}
