import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { EvalScoringError, matchFindings, parseExpectedFindings, scoreCase } from './scorer.js';

let nextId = 0;

function makeFinding(overrides: Partial<Finding> & Pick<Finding, 'file' | 'start_line' | 'end_line'>): Finding {
  nextId += 1;
  return {
    id: `finding-${nextId}`,
    severity: 'WARNING',
    category: 'bug',
    title: 'A finding',
    rationale: 'Because.',
    confidence: 0.9,
    ...overrides,
  };
}

describe('scorer', () => {
  it('matches on file + overlapping line range regardless of severity/category', () => {
    const expected = parseExpectedFindings([
      { file: 'a.ts', start_line: 10, end_line: 12, severity: 'CRITICAL', category: 'security' },
    ]);
    const produced = [
      makeFinding({ file: 'a.ts', start_line: 11, end_line: 20, severity: 'SUGGESTION', category: 'style' }),
    ];

    const matches = matchFindings(expected, produced);
    expect(matches).toEqual([{ expectedIndex: 0, producedIndex: 0 }]);

    const score = scoreCase(expected, { findings: produced, kept: 1, dropped: 0 });
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
  });

  it('computes recall and precision independently', () => {
    const expected = parseExpectedFindings([
      { file: 'a.ts', start_line: 1, end_line: 1 },
      { file: 'b.ts', start_line: 5, end_line: 5 },
    ]);
    const produced = [
      makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 }),
      makeFinding({ file: 'c.ts', start_line: 1, end_line: 1 }),
      makeFinding({ file: 'd.ts', start_line: 1, end_line: 1 }),
    ];

    const score = scoreCase(expected, { findings: produced, kept: 3, dropped: 0 });
    expect(score.recall).toBe(1 / 2);
    expect(score.precision).toBe(1 / 3);
  });

  it('degenerate 0/0 recall and precision both persist as 1', () => {
    const expected = parseExpectedFindings([]);
    const score = scoreCase(expected, { findings: [], kept: 0, dropped: 0 });

    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
    expect(score.pass).toBe(true);
  });

  it('citation_accuracy is kept/(kept+dropped); null when kept+dropped is 0 but the single-run response reports 1', () => {
    const expected = parseExpectedFindings([]);

    const grounded = scoreCase(expected, { findings: [], kept: 3, dropped: 1 });
    expect(grounded.citationAccuracyStored).toBe(0.75);
    expect(grounded.citationAccuracyResponse).toBe(0.75);

    const nothingGrounded = scoreCase(expected, { findings: [], kept: 0, dropped: 0 });
    expect(nothingGrounded.citationAccuracyStored).toBeNull();
    expect(nothingGrounded.citationAccuracyResponse).toBe(1);
  });

  it('pass is exactly recall===1 && precision===1', () => {
    const expected = parseExpectedFindings([
      { file: 'a.ts', start_line: 1, end_line: 1 },
      { file: 'b.ts', start_line: 5, end_line: 5 },
    ]);

    const bothPerfect = scoreCase(expected, {
      findings: [makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 }), makeFinding({ file: 'b.ts', start_line: 5, end_line: 5 })],
      kept: 2,
      dropped: 0,
    });
    expect(bothPerfect.recall).toBe(1);
    expect(bothPerfect.precision).toBe(1);
    expect(bothPerfect.pass).toBe(true);

    const recallOnlyMissesPrecision = scoreCase(expected, {
      findings: [
        makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 }),
        makeFinding({ file: 'b.ts', start_line: 5, end_line: 5 }),
        makeFinding({ file: 'c.ts', start_line: 1, end_line: 1 }),
      ],
      kept: 3,
      dropped: 0,
    });
    expect(recallOnlyMissesPrecision.recall).toBe(1);
    expect(recallOnlyMissesPrecision.precision).toBeLessThan(1);
    expect(recallOnlyMissesPrecision.pass).toBe(false);

    const precisionOnlyMissesRecall = scoreCase(expected, {
      findings: [makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 })],
      kept: 1,
      dropped: 0,
    });
    expect(precisionOnlyMissesRecall.recall).toBeLessThan(1);
    expect(precisionOnlyMissesRecall.precision).toBe(1);
    expect(precisionOnlyMissesRecall.pass).toBe(false);
  });

  it('rejects an expected_output that is not an array of {file,start_line,end_line}-shaped objects', () => {
    expect(() => parseExpectedFindings('not an array')).toThrow(EvalScoringError);
    expect(() => parseExpectedFindings(null)).toThrow(EvalScoringError);
    expect(() => parseExpectedFindings([{ file: 'a.ts' }])).toThrow(EvalScoringError);
    expect(() => parseExpectedFindings([{ file: 'a.ts', start_line: '1', end_line: 2 }])).toThrow(EvalScoringError);
    expect(() => parseExpectedFindings([{ file: 'a.ts', start_line: 1.5, end_line: 2 }])).toThrow(EvalScoringError);
  });

  it('traces_total counts expected_output entries; traces_passed counts matched ones', () => {
    const expected = parseExpectedFindings([
      { file: 'a.ts', start_line: 1, end_line: 1 },
      { file: 'b.ts', start_line: 5, end_line: 5 },
      { file: 'c.ts', start_line: 9, end_line: 9 },
    ]);
    const produced = [
      makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 }),
      makeFinding({ file: 'b.ts', start_line: 5, end_line: 5 }),
    ];

    const score = scoreCase(expected, { findings: produced, kept: 2, dropped: 0 });

    expect(score.tracesTotal).toBe(3);
    expect(score.tracesPassed).toBe(2);
    expect(score.perTrace).toHaveLength(3);
    expect(score.perTrace.map((t) => t.pass)).toEqual([true, true, false]);
  });
});
