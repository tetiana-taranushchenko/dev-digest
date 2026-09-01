import { z } from 'zod';
import type { EvalPerTrace, Finding } from '@devdigest/shared';

/**
 * Eval scorer — pure domain logic (`modules/eval/scorer.ts`, T2). No I/O, no
 * `Container`, no LLM call anywhere in this file (AC-8): matching is purely
 * mechanical (file + overlapping line range), the exact rule the mockup
 * states verbatim ("Scoring is mechanical — a finding counts when file
 * matches and line ranges overlap. No model call in the scorer.",
 * `screen_agents-evals-tab.jsx:190-192`).
 */

/**
 * Thrown when a case's `expected_output` cannot be read as a JSON array of
 * finding-shaped objects (AC-12). `eval/service.ts` (T5) maps this to a
 * `ValidationError` (422) — no `eval_runs` row is persisted for that case.
 */
export class EvalScoringError extends Error {}

const ExpectedFindingShape = z
  .object({
    file: z.string(),
    start_line: z.number().int(),
    end_line: z.number().int(),
  })
  // Extra fields (severity/category/title, mirroring `findingToSeed`) pass
  // through untouched — scoring itself never reads them (AC-44).
  .passthrough();

/**
 * One entry of a case's `expected_output` — always carries at least
 * `file`/`start_line`/`end_line` (AC-12); any extra fields pass through
 * unused by scoring (AC-44).
 */
export type ExpectedFinding = z.infer<typeof ExpectedFindingShape>;

/**
 * Parse+validate a case's raw `expected_output` (jsonb, `z.unknown()` at the
 * contract level) into `ExpectedFinding[]`. Throws `EvalScoringError` — never
 * returns a partially-valid array — on any shape mismatch (AC-12).
 */
export function parseExpectedFindings(raw: unknown): ExpectedFinding[] {
  const result = z.array(ExpectedFindingShape).safeParse(raw);
  if (!result.success) {
    throw new EvalScoringError(
      'expected_output must be a JSON array of {file, start_line, end_line} objects',
    );
  }
  return result.data;
}

/** True when `[aStart, aEnd]` and `[bStart, bEnd]` overlap (inclusive). */
function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * One expected↔produced pairing. Matching is greedy and one-to-one, walked in
 * `expected_output` order: each expected finding claims the first
 * not-yet-claimed produced finding whose `file` is identical and whose
 * `[start_line, end_line]` overlaps (AC-8, AC-44) — `severity`/`category` are
 * never compared, only surfaced as an informational diff by the caller.
 */
export interface FindingMatch {
  expectedIndex: number;
  producedIndex: number;
}

export function matchFindings(expected: ExpectedFinding[], produced: Finding[]): FindingMatch[] {
  const matches: FindingMatch[] = [];
  const claimed = new Set<number>();
  expected.forEach((exp, expectedIndex) => {
    const producedIndex = produced.findIndex(
      (p, i) =>
        !claimed.has(i) &&
        p.file === exp.file &&
        rangesOverlap(exp.start_line, exp.end_line, p.start_line, p.end_line),
    );
    if (producedIndex !== -1) {
      matches.push({ expectedIndex, producedIndex });
      claimed.add(producedIndex);
    }
  });
  return matches;
}

/**
 * `{ produced, per_trace }` — what `eval_runs.actual_output` stores
 * (Implementation Recommendations #1) instead of a bare `Finding[]`, so
 * `traces_passed`/`traces_total` are readable straight off a stored row with
 * no re-scoring.
 */
export interface EvalActualOutput {
  produced: Finding[];
  per_trace: EvalPerTrace[];
}

export interface ScoreCaseOutcome {
  /** Findings that survived the citation gate (`ReviewOutcome.review.findings`) — the run's produced findings. */
  findings: Finding[];
  /** Count of findings the citation gate kept — `ReviewOutcome.review.findings.length` (AC-10). */
  kept: number;
  /** Count of findings the citation gate dropped — `ReviewOutcome.dropped.length` (AC-10). */
  dropped: number;
}

export interface ScoreCaseResult {
  recall: number;
  precision: number;
  /** Persisted value — `null` when `kept + dropped === 0` (AC-38). */
  citationAccuracyStored: number | null;
  /** Single-run response value — `1` when `kept + dropped === 0` (AC-38's "nothing to ground" is vacuously accurate); otherwise equal to `citationAccuracyStored`. */
  citationAccuracyResponse: number;
  pass: boolean;
  perTrace: EvalPerTrace[];
  tracesPassed: number;
  tracesTotal: number;
}

/**
 * Human-readable trace name for one expected finding — `file:start-end` (or
 * `file:line` for a single-line range). No AC pins this exact string down;
 * chosen for the client's per-trace list (T11's `CaseRow`).
 */
function traceName(exp: ExpectedFinding): string {
  return exp.start_line === exp.end_line
    ? `${exp.file}:${exp.start_line}`
    : `${exp.file}:${exp.start_line}-${exp.end_line}`;
}

/**
 * Score one run: mechanical matching (AC-8/AC-44), recall/precision (AC-9,
 * always in `0..1` by construction), citation accuracy (AC-10, null-vs-1
 * split per AC-38), pass (AC-11/AC-40), and per-trace results (AC-48 — one
 * trace per `expected_output` entry, not per case).
 *
 * Degenerate 0-total cases (AC-37) are handled independently for each
 * metric's own denominator: `recall` defaults to `1` when `expected` is
 * empty; `precision` defaults to `1` when nothing was produced — "a negative
 * case with nothing wrongly flagged is a passing result" generalizes beyond
 * AC-37's stated double-empty case to "zero produced findings never counts
 * against precision," which is the same "nothing wrongly flagged" reasoning.
 */
export function scoreCase(expected: ExpectedFinding[], outcome: ScoreCaseOutcome): ScoreCaseResult {
  const matches = matchFindings(expected, outcome.findings);
  const matchByExpectedIndex = new Map(matches.map((m) => [m.expectedIndex, outcome.findings[m.producedIndex]]));

  const recall = expected.length === 0 ? 1 : matches.length / expected.length;
  const precision = outcome.findings.length === 0 ? 1 : matches.length / outcome.findings.length;

  const groundedTotal = outcome.kept + outcome.dropped;
  const citationAccuracyStored = groundedTotal === 0 ? null : outcome.kept / groundedTotal;
  const citationAccuracyResponse = citationAccuracyStored ?? 1;

  const pass = recall === 1 && precision === 1;

  const perTrace: EvalPerTrace[] = expected.map((exp, i) => ({
    name: traceName(exp),
    pass: matchByExpectedIndex.has(i),
    expected: exp,
    actual: matchByExpectedIndex.get(i) ?? null,
  }));

  return {
    recall,
    precision,
    citationAccuracyStored,
    citationAccuracyResponse,
    pass,
    perTrace,
    tracesPassed: matches.length,
    tracesTotal: expected.length,
  };
}

/** Build the `eval_runs.actual_output` payload (Implementation Recommendations #1). */
export function buildActualOutput(
  outcome: { findings: Finding[] },
  score: { perTrace: EvalPerTrace[] },
): EvalActualOutput {
  return { produced: outcome.findings, per_trace: score.perTrace };
}
