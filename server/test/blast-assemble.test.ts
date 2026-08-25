/**
 * `assembleBlastRadius` (`modules/blast/assemble.ts`, T4) — pure
 * `(blast, index, reverse, changedFiles, now) -> BlastRadius` assembly. Every
 * fixture is checked against the real `BlastRadius` Zod contract
 * (`src/vendor/shared/contracts/brief.ts:103-118`) via `BlastRadius.parse()`.
 */
import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import { assembleBlastRadius, toPriorPrs, type PriorPrSource } from '../src/modules/blast/assemble.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { BlastCallerRow, BlastResult, IndexState, ReverseImpactResult } from '../src/modules/repo-intel/types.js';

const NOW = new Date('2026-08-20T12:00:00.000Z');

function indexState(overrides: Partial<IndexState> = {}): IndexState {
  return {
    repoId: 'repo-1',
    status: 'full',
    filesIndexed: 10,
    filesSkipped: 0,
    durationMs: 100,
    lastIndexedSha: 'abc123',
    indexerVersion: 2,
    updatedAt: new Date('2026-08-19T00:00:00.000Z'),
    ...overrides,
  };
}

function reverseImpact(overrides: Partial<ReverseImpactResult> = {}): ReverseImpactResult {
  return {
    files: [],
    endpoints: [],
    crons: [],
    byFile: {},
    originsByFile: {},
    depthLimited: false,
    ...overrides,
  };
}

function blastResult(overrides: Partial<BlastResult> = {}): BlastResult {
  return {
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    ...overrides,
  };
}

function caller(overrides: Partial<BlastCallerRow>): BlastCallerRow {
  return { file: 'src/caller.ts', symbol: 'caller', viaSymbol: 'foo', line: 1, rank: 0, ...overrides };
}

describe('assembleBlastRadius', () => {
  it('state: ok — a real caller in another file, with a same-file self-reference excluded (REQ-2c / Gotcha 3)', () => {
    const blast = blastResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        caller({ file: 'src/b.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 5 }),
        // Same-file self-reference: must be dropped from foo's callers.
        caller({ file: 'src/a.ts', symbol: 'foo', viaSymbol: 'foo', line: 2, rank: 9 }),
      ],
      impactedEndpoints: ['GET /api/foo'],
      factsByFile: { 'src/b.ts': { endpoints: ['GET /api/foo'], crons: [] } },
      degraded: false,
    });

    const result = BlastRadius.parse(
      assembleBlastRadius({ blast, index: indexState(), reverse: reverseImpact(), changedFiles: ['src/a.ts'], now: NOW }),
    );

    expect(result.state).toBe('ok');
    expect(result.reason).toBeNull();
    expect(result.reason_text).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.index_status).toBe('full');
    expect(result.generated_at).toBe(NOW.toISOString());

    expect(result.downstream).toHaveLength(1);
    const fooImpact = result.downstream[0]!;
    expect(fooImpact.symbol).toBe('foo');
    expect(fooImpact.file).toBe('src/a.ts');
    expect(fooImpact.caller_count).toBe(1);
    expect(fooImpact.callers.map((c) => c.file)).toEqual(['src/b.ts']);
    // The declaring file must never appear in its own symbol's callers.
    expect(fooImpact.callers.some((c) => c.file === 'src/a.ts')).toBe(false);
    expect(fooImpact.endpoints_affected).toEqual(['GET /api/foo']);
  });

  it('state: empty — no callers/endpoints/crons after excluding a same-file self-reference', () => {
    const blast = blastResult({
      changedSymbols: [{ file: 'src/c.ts', name: 'bar', kind: 'function' }],
      callers: [caller({ file: 'src/c.ts', symbol: 'bar', viaSymbol: 'bar', line: 4, rank: 1 })],
      impactedEndpoints: [],
      degraded: false,
    });

    const result = BlastRadius.parse(
      assembleBlastRadius({ blast, index: indexState(), reverse: reverseImpact(), changedFiles: ['src/c.ts'], now: NOW }),
    );

    expect(result.state).toBe('empty');
    expect(result.reason).toBe('no_impact');
    expect(result.reason_text).not.toBeNull();
    expect(result.downstream).toHaveLength(1);
    expect(result.downstream[0]!.caller_count).toBe(0);
    expect(result.downstream[0]!.callers.some((c) => c.file === 'src/c.ts')).toBe(false);
  });

  it('state: partial (index_status partial) — index only partially built', () => {
    const blast = blastResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        caller({ file: 'src/b.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 5 }),
        caller({ file: 'src/a.ts', symbol: 'foo', viaSymbol: 'foo', line: 2, rank: 9 }),
      ],
      degraded: false,
    });

    const result = BlastRadius.parse(
      assembleBlastRadius({
        blast,
        index: indexState({ status: 'partial' }),
        reverse: reverseImpact(),
        changedFiles: ['src/a.ts'],
        now: NOW,
      }),
    );

    expect(result.state).toBe('partial');
    expect(result.reason).toBe('index_partial');
    expect(result.reason_text).not.toBeNull();
    expect(result.index_status).toBe('partial');
    expect(result.downstream[0]!.callers.some((c) => c.file === 'src/a.ts')).toBe(false);
  });

  it('state: partial (caller cap) — one symbol has more than MAX_CALLERS_PER_SYMBOL real callers', () => {
    const overflowCount = MAX_CALLERS_PER_SYMBOL + 5;
    const callers: BlastCallerRow[] = [];
    for (let i = 0; i < overflowCount; i++) {
      callers.push(caller({ file: `src/caller-${i}.ts`, symbol: `c${i}`, viaSymbol: 'foo', line: i + 1, rank: i }));
    }
    // Same-file self-reference — must be excluded and must not count toward caller_count.
    callers.push(caller({ file: 'src/a.ts', symbol: 'foo', viaSymbol: 'foo', line: 1, rank: 999 }));

    const blast = blastResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers,
      degraded: false,
    });

    const result = BlastRadius.parse(
      assembleBlastRadius({ blast, index: indexState(), reverse: reverseImpact(), changedFiles: ['src/a.ts'], now: NOW }),
    );

    expect(result.state).toBe('partial');
    expect(result.reason).toBe('caller_cap');
    expect(result.reason_text).not.toBeNull();
    expect(result.truncated).toBe(true);

    const fooImpact = result.downstream[0]!;
    expect(fooImpact.caller_count).toBe(overflowCount);
    expect(fooImpact.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL);
    expect(fooImpact.callers.some((c) => c.file === 'src/a.ts')).toBe(false);
    // Highest-rank callers win the cap (rank desc).
    expect(fooImpact.callers[0]!.file).toBe(`src/caller-${overflowCount - 1}.ts`);
  });

  it('state: degraded (with data) — ripgrep fallback returns real data but is always degraded (Gotcha 1)', () => {
    const blast = blastResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [
        caller({ file: 'src/b.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 0 }),
        caller({ file: 'src/a.ts', symbol: 'foo', viaSymbol: 'foo', line: 2, rank: 0 }),
      ],
      degraded: true,
      reason: 'no_data',
    });

    const result = BlastRadius.parse(
      assembleBlastRadius({ blast, index: indexState(), reverse: reverseImpact(), changedFiles: ['src/a.ts'], now: NOW }),
    );

    expect(result.state).toBe('degraded');
    expect(result.reason).toBe('no_data');
    expect(result.reason_text).not.toBeNull();
    // Even in the degraded-with-data case, the self-reference must be excluded.
    expect(result.downstream[0]!.callers.some((c) => c.file === 'src/a.ts')).toBe(false);
    expect(result.downstream[0]!.callers.map((c) => c.file)).toEqual(['src/b.ts']);
  });

  it('state: degraded (index_status: failed) — distinct from the missing-index case (different index_status/reason)', () => {
    const blast = blastResult({ changedSymbols: [], callers: [], degraded: false });
    const failedIndex = indexState({ status: 'failed', lastIndexedSha: 'abc123', degradedReason: 'index_failed' });

    const result = BlastRadius.parse(
      assembleBlastRadius({ blast, index: failedIndex, reverse: reverseImpact(), changedFiles: ['src/a.ts'], now: NOW }),
    );

    expect(result.state).toBe('degraded');
    expect(result.index_status).toBe('failed');
    // A build FAILURE is distinct from an index that was simply never built (see the
    // "no index" case below): index_status is 'failed', not 'missing', and the reason
    // reflects the actual failure rather than the synthesised no_data fallback.
    expect(result.reason).toBe('index_failed');
    expect(result.reason_text).not.toBeNull();
  });

  it('state: partial (depth cap) — reverse-impact walk was capped by BFS_DEPTH, independent of index status or truncation', () => {
    const blast = blastResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [caller({ file: 'src/b.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 5 })],
      degraded: false,
    });

    const result = BlastRadius.parse(
      assembleBlastRadius({
        blast,
        index: indexState(), // status: 'full' — the index itself is healthy and complete
        reverse: reverseImpact({ depthLimited: true }),
        changedFiles: ['src/a.ts'],
        now: NOW,
      }),
    );

    expect(result.state).toBe('partial');
    expect(result.reason).toBe('depth_cap');
    expect(result.reason_text).not.toBeNull();
    // Neither the index status nor the per-symbol caller cap triggered this —
    // only the reverse-walk depth limit did.
    expect(result.index_status).toBe('full');
    expect(result.truncated).toBe(false);
  });

  it('rule 4(b) scopes reverse-impact facts per symbol declaring file — one symbol only, not both (architecture-reviewer MEDIUM fix)', () => {
    // Two changed files, each declaring its own symbol. `symbolZ`'s file
    // (src/z.ts) is upstream of an HTTP route (via the reverse-impact walk);
    // `symbolA`'s file (src/a.ts) is not. Only `symbolZ`'s downstream row
    // should show that endpoint — `symbolA`'s must NOT, even though both
    // symbols are in the same `getReverseImpact` batched call.
    const blast = blastResult({
      changedSymbols: [
        { file: 'src/a.ts', name: 'symbolA', kind: 'function' },
        { file: 'src/z.ts', name: 'symbolZ', kind: 'function' },
      ],
      callers: [
        caller({ file: 'src/a-caller.ts', symbol: 'callerA', viaSymbol: 'symbolA', line: 1, rank: 1 }),
        caller({ file: 'src/z-caller.ts', symbol: 'callerZ', viaSymbol: 'symbolZ', line: 1, rank: 1 }),
      ],
      degraded: false,
    });

    // Batched reverse-impact result over ['src/a.ts', 'src/z.ts']: only
    // src/route.ts is reachable, and only from src/z.ts (per originsByFile).
    const reverse: ReverseImpactResult = reverseImpact({
      files: ['src/route.ts'],
      endpoints: ['GET /api/z-route'],
      byFile: { 'src/route.ts': { endpoints: ['GET /api/z-route'], crons: [] } },
      originsByFile: { 'src/route.ts': ['src/z.ts'] },
    });

    const result = BlastRadius.parse(
      assembleBlastRadius({
        blast,
        index: indexState(),
        reverse,
        changedFiles: ['src/a.ts', 'src/z.ts'],
        now: NOW,
      }),
    );

    const symbolA = result.downstream.find((d) => d.symbol === 'symbolA')!;
    const symbolZ = result.downstream.find((d) => d.symbol === 'symbolZ')!;
    expect(symbolZ.endpoints_affected).toEqual(['GET /api/z-route']);
    expect(symbolA.endpoints_affected).toEqual([]);
  });

  it('state: degraded (no index) — repo never indexed, getIndexState synthesises the missing row', () => {
    const blast = blastResult({ changedSymbols: [], callers: [], degraded: true, reason: 'no_data' });
    const missingIndex = indexState({
      status: 'degraded',
      lastIndexedSha: '',
      degraded: true,
      degradedReason: 'no_data',
    });

    const result = BlastRadius.parse(
      assembleBlastRadius({ blast, index: missingIndex, reverse: reverseImpact(), changedFiles: ['src/a.ts'], now: NOW }),
    );

    expect(result.state).toBe('degraded');
    expect(result.index_status).toBe('missing');
    expect(result.reason).toBe('no_data');
    expect(result.reason_text).not.toBeNull();
    expect(result.downstream).toHaveLength(0);
    // No symbols at all -> trivially no self-referencing caller in any group.
    expect(result.downstream.every((d) => d.callers.every((c) => c.file !== d.file))).toBe(true);
  });

  it('prior_prs (REQ-5): never influences state/reason/truncated/index_status/changed_symbols/downstream — ok and degraded fixtures', () => {
    const priorPrs: PriorPrSource[] = [
      { number: 42, title: 'Refactor caller resolution', updatedAt: new Date('2026-08-10T00:00:00.000Z') },
      { number: 7, title: 'Add reverse-impact walk', updatedAt: null },
    ];

    const okBlast = blastResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [caller({ file: 'src/b.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 5 })],
      impactedEndpoints: ['GET /api/foo'],
      factsByFile: { 'src/b.ts': { endpoints: ['GET /api/foo'], crons: [] } },
      degraded: false,
    });
    const okArgs = { blast: okBlast, index: indexState(), reverse: reverseImpact(), changedFiles: ['src/a.ts'], now: NOW };

    const okWithoutPriorPrs = BlastRadius.parse(assembleBlastRadius({ ...okArgs, priorPrs: [] }));
    const okWithPriorPrs = BlastRadius.parse(assembleBlastRadius({ ...okArgs, priorPrs }));

    for (const key of ['state', 'reason', 'reason_text', 'truncated', 'index_status', 'changed_symbols', 'downstream'] as const) {
      expect(okWithPriorPrs[key]).toEqual(okWithoutPriorPrs[key]);
    }
    expect(okWithPriorPrs.prior_prs).toHaveLength(2);
    expect(okWithoutPriorPrs.prior_prs).toEqual([]);

    const degradedBlast = blastResult({ changedSymbols: [], callers: [], degraded: true, reason: 'no_data' });
    const missingIndex = indexState({ status: 'degraded', lastIndexedSha: '', degraded: true, degradedReason: 'no_data' });
    const degradedArgs = {
      blast: degradedBlast,
      index: missingIndex,
      reverse: reverseImpact(),
      changedFiles: ['src/a.ts'],
      now: NOW,
    };

    const degradedWithoutPriorPrs = BlastRadius.parse(assembleBlastRadius({ ...degradedArgs, priorPrs: [] }));
    const degradedWithPriorPrs = BlastRadius.parse(assembleBlastRadius({ ...degradedArgs, priorPrs }));

    for (const key of ['state', 'reason', 'reason_text', 'truncated', 'index_status', 'changed_symbols', 'downstream'] as const) {
      expect(degradedWithPriorPrs[key]).toEqual(degradedWithoutPriorPrs[key]);
    }
    expect(degradedWithPriorPrs.prior_prs).toHaveLength(2);
    expect(degradedWithoutPriorPrs.prior_prs).toEqual([]);
  });

  it('toPriorPrs maps updatedAt Date -> ISO string and null -> null, preserving input order', () => {
    const rows: PriorPrSource[] = [
      { number: 42, title: 'Refactor caller resolution', updatedAt: new Date('2026-08-10T00:00:00.000Z') },
      { number: 7, title: 'Add reverse-impact walk', updatedAt: null },
    ];

    const result = toPriorPrs(rows);

    expect(result).toEqual([
      { number: 42, title: 'Refactor caller resolution', updated_at: '2026-08-10T00:00:00.000Z' },
      { number: 7, title: 'Add reverse-impact walk', updated_at: null },
    ]);
  });

  it('priorPrs: [] -> prior_prs: [] (never null, never omitted) — "[]" unambiguously means "computed, found none"', () => {
    const blast = blastResult({
      changedSymbols: [{ file: 'src/a.ts', name: 'foo', kind: 'function' }],
      callers: [caller({ file: 'src/b.ts', symbol: 'bar', viaSymbol: 'foo', line: 10, rank: 5 })],
      degraded: false,
    });

    const result = assembleBlastRadius({
      blast,
      index: indexState(),
      reverse: reverseImpact(),
      changedFiles: ['src/a.ts'],
      now: NOW,
      priorPrs: [],
    });

    expect(result.prior_prs).toEqual([]);
    expect(result.prior_prs).not.toBeNull();
    expect(result.prior_prs).toBeDefined();

    const parsed = BlastRadius.parse(result);
    expect(parsed.prior_prs).toEqual([]);
  });
});
