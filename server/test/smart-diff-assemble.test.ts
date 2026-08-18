/**
 * Smart Diff assembler (`modules/smart-diff/assemble.ts`, T3) — pure
 * `(files, findingLinesByPath) -> SmartDiff` assembly. Every fixture is
 * checked against the real `SmartDiff` Zod contract
 * (`src/vendor/shared/contracts/brief.ts:124-156`) via `SmartDiff.parse()`.
 */
import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import {
  assembleSmartDiff,
  type SmartDiffFindingInput,
  type SmartDiffInputFile,
} from '../src/modules/smart-diff/assemble.js';
import { SPLIT_TOO_BIG_LINES } from '../src/modules/smart-diff/constants.js';

describe('assembleSmartDiff', () => {
  it('returns the empty-PR fallback shape when pr_files have not been persisted yet', () => {
    const result = assembleSmartDiff([], new Map());
    const parsed = SmartDiff.parse(result);

    expect(parsed.groups).toEqual([]);
    expect(parsed.split_suggestion.total_lines).toBe(0);
    expect(parsed.split_suggestion.too_big).toBe(false);
    expect(parsed.split_suggestion.proposed_splits).toEqual([]);
    expect(parsed.review_tokens).toBeNull();
  });

  it('threads the caller-computed reviewTokens straight through (defaults to null when omitted)', () => {
    const files: SmartDiffInputFile[] = [{ path: 'src/a.ts', additions: 1, deletions: 0 }];

    expect(SmartDiff.parse(assembleSmartDiff(files, new Map())).review_tokens).toBeNull();
    expect(SmartDiff.parse(assembleSmartDiff(files, new Map(), 250)).review_tokens).toBe(250);
  });

  it('does not flag too_big exactly at the SPLIT_TOO_BIG_LINES threshold, but does one line over it', () => {
    const atThreshold: SmartDiffInputFile[] = [
      { path: 'src/exact.ts', additions: SPLIT_TOO_BIG_LINES, deletions: 0 },
    ];
    const overThreshold: SmartDiffInputFile[] = [
      { path: 'src/exact.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 },
    ];

    const atResult = SmartDiff.parse(assembleSmartDiff(atThreshold, new Map()));
    const overResult = SmartDiff.parse(assembleSmartDiff(overThreshold, new Map()));

    expect(atResult.split_suggestion.too_big).toBe(false);
    expect(overResult.split_suggestion.too_big).toBe(true);
  });

  it('groups core-first, wiring, then collapsed boilerplate, with a lock file not tripping too_big', () => {
    const files: SmartDiffInputFile[] = [
      { path: 'src/modules/pulls/service.ts', additions: 10, deletions: 2 },
      { path: 'src/index.ts', additions: 5, deletions: 1 },
      { path: 'pnpm-lock.yaml', additions: 500, deletions: 500 },
    ];

    const result = assembleSmartDiff(files, new Map());
    const parsed = SmartDiff.parse(result);

    expect(parsed.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    for (const group of parsed.groups) {
      for (const file of group.files) {
        expect(file.pseudocode_summary).toBeNull();
        expect(file.line_findings).toEqual([]);
      }
    }

    // core (12) + wiring (6) = 18 lines; the 1000-line lock file must not count.
    expect(parsed.split_suggestion.too_big).toBe(false);
    expect(parsed.split_suggestion.proposed_splits).toEqual([]);
    expect(parsed.split_suggestion.total_lines).toBe(10 + 2 + 5 + 1 + 500 + 500);
  });

  it('sorts files by finding count desc, then lines desc, then path asc, with de-duplicated (by id) ascending line_findings', () => {
    const files: SmartDiffInputFile[] = [
      { path: 'src/z.ts', additions: 5, deletions: 5 },
      { path: 'src/a.ts', additions: 1, deletions: 1 },
      { path: 'src/m.ts', additions: 100, deletions: 0 },
      { path: 'src/b.ts', additions: 50, deletions: 0 },
      { path: 'index.ts', additions: 3, deletions: 0 },
      { path: 'yarn.lock', additions: 200, deletions: 0 },
    ];
    const findingsByPath = new Map<string, SmartDiffFindingInput[]>([
      [
        'src/a.ts',
        [
          { id: 'f-30', line: 30, severity: 'WARNING' },
          { id: 'f-10', line: 10, severity: 'WARNING' },
          { id: 'f-10', line: 10, severity: 'WARNING' }, // duplicate id — must collapse to one
          { id: 'f-20', line: 20, severity: 'CRITICAL' },
        ],
      ],
      ['src/m.ts', [{ id: 'f-5', line: 5, severity: 'SUGGESTION' }]],
    ]);

    const result = assembleSmartDiff(files, findingsByPath);
    const parsed = SmartDiff.parse(result);

    expect(parsed.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);

    const coreGroup = parsed.groups.find((g) => g.role === 'core')!;
    expect(coreGroup.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/m.ts', 'src/b.ts', 'src/z.ts']);
    expect(coreGroup.files.find((f) => f.path === 'src/a.ts')!.line_findings).toEqual([
      { id: 'f-10', line: 10, severity: 'WARNING' },
      { id: 'f-20', line: 20, severity: 'CRITICAL' },
      { id: 'f-30', line: 30, severity: 'WARNING' },
    ]);
    expect(coreGroup.files.find((f) => f.path === 'src/m.ts')!.line_findings).toEqual([
      { id: 'f-5', line: 5, severity: 'SUGGESTION' },
    ]);

    const wiringGroup = parsed.groups.find((g) => g.role === 'wiring')!;
    expect(wiringGroup.files.map((f) => f.path)).toEqual(['index.ts']);

    const boilerplateGroup = parsed.groups.find((g) => g.role === 'boilerplate')!;
    expect(boilerplateGroup.files.map((f) => f.path)).toEqual(['yarn.lock']);

    for (const group of parsed.groups) {
      for (const file of group.files) {
        expect(file.pseudocode_summary).toBeNull();
      }
    }

    // core+wiring lines = (2 + 100 + 50 + 10) + 3 = 165, below the 400 threshold.
    expect(parsed.split_suggestion.too_big).toBe(false);
    expect(parsed.split_suggestion.total_lines).toBe(2 + 100 + 50 + 10 + 3 + 200);
  });

  it('flags an oversized PR and proposes top-level-directory splits, capped and sorted by line count desc', () => {
    const files: SmartDiffInputFile[] = [
      // "src" group: 3 files, 450 lines
      { path: 'src/moduleA/file1.ts', additions: 150, deletions: 50 },
      { path: 'src/moduleA/file2.ts', additions: 100, deletions: 50 },
      { path: 'src/moduleB/file3.ts', additions: 60, deletions: 40 },
      // "server" group: 2 files, 300 lines
      { path: 'server/a.ts', additions: 150, deletions: 50 },
      { path: 'server/b.ts', additions: 80, deletions: 20 },
      // "client" group: 2 files, 200 lines
      { path: 'client/a.ts', additions: 100, deletions: 50 },
      { path: 'client/b.ts', additions: 30, deletions: 20 },
      // "e2e" group: 2 files, 100 lines — pushed out by the MAX_PROPOSED_SPLITS cap
      { path: 'e2e/a.ts', additions: 50, deletions: 30 },
      { path: 'e2e/b.ts', additions: 15, deletions: 5 },
      // "lib" group: single file — dropped for being below SPLIT_MIN_FILES_PER_GROUP
      { path: 'lib/solo.ts', additions: 30, deletions: 20 },
      // boilerplate bulk — must not affect too_big, but does count toward total_lines
      { path: 'pnpm-lock.yaml', additions: 5000, deletions: 0 },
    ];

    const result = assembleSmartDiff(files, new Map());
    const parsed = SmartDiff.parse(result);

    expect(parsed.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
    for (const group of parsed.groups) {
      for (const file of group.files) {
        expect(file.pseudocode_summary).toBeNull();
      }
    }

    expect(parsed.split_suggestion.too_big).toBe(true);
    expect(parsed.split_suggestion.total_lines).toBe(450 + 300 + 200 + 100 + 50 + 5000);
    expect(parsed.split_suggestion.proposed_splits).toEqual([
      { name: 'src', files: ['src/moduleA/file1.ts', 'src/moduleA/file2.ts', 'src/moduleB/file3.ts'] },
      { name: 'server', files: ['server/a.ts', 'server/b.ts'] },
      { name: 'client', files: ['client/a.ts', 'client/b.ts'] },
    ]);
  });
});
