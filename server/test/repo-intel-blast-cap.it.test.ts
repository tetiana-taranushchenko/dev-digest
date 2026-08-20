/**
 * Regression for Gotcha 2 (docs/plans/blast-radius.md): `constants.ts:30`
 * documents `MAX_CALLERS_PER_SYMBOL` as a cap "per changed symbol", but
 * `tryPersistentBlast` used to apply `callers.slice(0, MAX_CALLERS_PER_SYMBOL)`
 * to the whole flat caller list. With 2 changed symbols and 25 resolved
 * callers each, that bug would return only 20 rows total (all from whichever
 * symbol happened to sort first) instead of 20 per symbol (40 total).
 *
 * Corrected design (post architecture-reviewer audit, see
 * docs/plans/blast-radius.md "Contract changes" + T2/T4 notes): applying
 * MAX_CALLERS_PER_SYMBOL a SECOND time here — after `blast/assemble.ts`
 * already applies it once per `viaSymbol` group — made it mathematically
 * impossible for `assemble.ts` to ever see a true pre-cap count, so
 * `caller_count` could never exceed the cap and `truncated` could never
 * become `true` from real data. `tryPersistentBlast` now only GROUPS and
 * SORTS callers per `viaSymbol` (rank desc, file asc, line asc) and returns
 * the FULL list; the cap + truncation detection is `blast/assemble.ts`'s job
 * alone (T4 rule 2), where the full pre-cap count is available.
 *
 * This test seeds a real persistent index (repo_index_state = 'full', symbol
 * rows for 2 changed symbols, resolved `references` rows with distinct
 * `rank` values per caller) and asserts `getBlastRadius` returns the FULL 25
 * callers per `viaSymbol` (50 total, uncapped), sorted rank-descending
 * within each group — i.e. this test proves the sorting/grouping contract,
 * not a cap that no longer belongs at this layer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelRepository } from '../src/modules/repo-intel/repository.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { INDEXER_VERSION } from '../src/modules/repo-intel/constants.js';
import type { BlastCallerRow } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const CALLERS_PER_SYMBOL = 25;

d('getBlastRadius — groups and sorts callers per viaSymbol without capping at this layer', () => {
  let pg: PgFixture;
  let repoId: string;
  let service: RepoIntelService;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws!.id, owner: 'acme', name: 'blast-cap', fullName: 'acme/blast-cap' })
      .returning();
    repoId = r!.id;

    // Real, usable index state so tryPersistentBlast doesn't bail to the
    // ripgrep fallback.
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId,
      lastIndexedSha: 'deadbeef',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 52,
      filesSkipped: 0,
      stats: {},
    });

    const repo = new RepoIntelRepository(pg.handle.db);

    // Two changed symbols, each declared in its own file.
    await repo.insertSymbols([
      {
        repoId,
        path: 'src/a.ts',
        name: 'symA',
        kind: 'function',
        line: 1,
        endLine: 5,
        exported: true,
        signature: null,
        contentHash: 'h-a',
      },
      {
        repoId,
        path: 'src/b.ts',
        name: 'symB',
        kind: 'function',
        line: 1,
        endLine: 5,
        exported: true,
        signature: null,
        contentHash: 'h-b',
      },
    ]);

    // 25 resolved callers per symbol, from 25 distinct caller files each, with
    // a distinct `rank` per caller file so the top-20 cap is deterministic.
    const referenceRows: (typeof t.references.$inferInsert)[] = [];
    const fileRankRows: (typeof t.fileRank.$inferInsert)[] = [];
    for (const sym of ['symA', 'symB'] as const) {
      const declFile = sym === 'symA' ? 'src/a.ts' : 'src/b.ts';
      for (let i = 0; i < CALLERS_PER_SYMBOL; i += 1) {
        const fromPath = `src/caller-${sym}-${String(i).padStart(2, '0')}.ts`;
        referenceRows.push({
          repoId,
          fromPath,
          toSymbol: sym,
          line: 10 + i,
          declFile,
          contentHash: `hc-${sym}-${i}`,
        });
        fileRankRows.push({
          repoId,
          filePath: fromPath,
          pagerank: i,
          hotness: 0,
          rank: i, // distinct per caller — highest i = highest rank
          percentile: i,
        });
      }
    }
    await pg.handle.db.insert(t.references).values(referenceRows);
    await pg.handle.db.insert(t.fileRank).values(fileRankRows);

    const container = {
      config: { repoIntelEnabled: true },
      db: pg.handle.db,
    } as never;
    service = new RepoIntelService(container);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('returns the full 25 callers per viaSymbol (50 total, uncapped), rank-descending within each group', async () => {
    const result = await service.getBlastRadius(repoId, ['src/a.ts', 'src/b.ts']);

    expect(result.degraded).toBe(false);
    // No cap at this layer: the full pre-cap list survives so `blast/assemble.ts`
    // can compute an honest `caller_count` and detect `truncated` itself.
    expect(result.callers).toHaveLength(2 * CALLERS_PER_SYMBOL);

    const byViaSymbol = new Map<string, BlastCallerRow[]>();
    for (const c of result.callers) {
      const group = byViaSymbol.get(c.viaSymbol);
      if (group) group.push(c);
      else byViaSymbol.set(c.viaSymbol, [c]);
    }

    expect([...byViaSymbol.keys()].sort()).toEqual(['symA', 'symB']);

    for (const [viaSymbol, group] of byViaSymbol) {
      // All CALLERS_PER_SYMBOL callers survived for THIS symbol — the bug this
      // test used to guard against (and now guards against in the opposite
      // direction) was any cap being applied at this layer at all.
      expect(group).toHaveLength(CALLERS_PER_SYMBOL);

      // Rank-descending within the group.
      for (let i = 1; i < group.length; i += 1) {
        expect(group[i - 1]!.rank).toBeGreaterThanOrEqual(group[i]!.rank);
      }

      // Seeded ranks were 0..24 per symbol; all of them must survive uncapped.
      const survivingRanks = group.map((c) => c.rank).sort((a, b) => a - b);
      expect(survivingRanks).toEqual(
        Array.from({ length: CALLERS_PER_SYMBOL }, (_, i) => i),
      );

      // File-asc / line-asc tie-break only matters among equal ranks; ranks
      // are distinct here (0..24), so rank-desc alone determines order — but
      // assert file ordering matches the seeded fromPath naming to lock in
      // the grouping/sorting contract itself, not just the cap removal.
      for (let i = 1; i < group.length; i += 1) {
        const prev = group[i - 1]!;
        const curr = group[i]!;
        expect(
          prev.rank > curr.rank ||
            (prev.rank === curr.rank && prev.file <= curr.file),
        ).toBe(true);
      }

      expect(group.every((c) => c.viaSymbol === viaSymbol)).toBe(true);
    }
  });
});
