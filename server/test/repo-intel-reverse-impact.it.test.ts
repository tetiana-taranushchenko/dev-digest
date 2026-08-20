/**
 * Regression / coverage for T3 (docs/plans/blast-radius.md): `repository.ts`
 * had no reverse-graph read before this — `getEdges` is a full-table forward
 * read used by `getCriticalPaths`, not the "who depends on this file?"
 * O(degree) lookup the `file_edges_repo_to_idx (repo_id, to_file)` index
 * exists for. This test seeds a real persistent index with a chain
 * `a.ts -> b.ts -> c.ts -> d.ts` (a imports b, b imports c, c imports d) and
 * asserts `getReverseImpact` walks the REVERSE graph from `d.ts` up to
 * `BFS_DEPTH` (2) hops: `c.ts` at depth 1, `b.ts` at depth 2, but NOT `a.ts`
 * (one hop beyond the cutoff) — while still reporting `depthLimited: true`
 * because more graph exists beyond what the cap allowed it to explore.
 *
 * Also covers the architecture-reviewer MEDIUM fix: `getReverseImpact` is a
 * single BATCHED multi-source BFS over the whole `changedFiles` list (one
 * `getImporters` call per round, not one per source, for query efficiency —
 * REQ-5). Without per-origin provenance, two unrelated changed files sharing
 * one batched call would have their reachable-file sets silently merged,
 * making it impossible to tell which origin actually reached which file.
 * `originsByFile` fixes that: it records, per visited file, which of the
 * original `changedFiles` reached it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { BFS_DEPTH } from '../src/modules/repo-intel/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

d('getReverseImpact — reverse BFS walk over file_edges, capped at BFS_DEPTH', () => {
  let pg: PgFixture;
  let repoId: string;
  let service: RepoIntelService;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    const [r] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws!.id,
        owner: 'acme',
        name: 'reverse-impact',
        fullName: 'acme/reverse-impact',
      })
      .returning();
    repoId = r!.id;

    // Chain: a.ts -> b.ts -> c.ts -> d.ts (a imports b, b imports c, c imports d).
    // Walking the REVERSE graph from d.ts: c.ts is 1 hop away, b.ts is 2 hops
    // away, a.ts is 3 hops away — beyond BFS_DEPTH (2).
    await pg.handle.db.insert(t.fileEdges).values([
      { repoId, fromFile: 'a.ts', toFile: 'b.ts' },
      { repoId, fromFile: 'b.ts', toFile: 'c.ts' },
      { repoId, fromFile: 'c.ts', toFile: 'd.ts' },
    ]);

    await pg.handle.db.insert(t.fileFacts).values([
      { repoId, filePath: 'c.ts', endpoints: ['GET /c'], crons: [] },
      { repoId, filePath: 'd.ts', endpoints: ['GET /d'], crons: ['cron:d'] },
    ]);

    const container = {
      config: { repoIntelEnabled: true },
      db: pg.handle.db,
    } as never;
    service = new RepoIntelService(container);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('reaches c.ts (depth 1) and b.ts (depth 2), excludes a.ts, and reports depthLimited: true', async () => {
    expect(BFS_DEPTH).toBe(2);

    const result = await service.getReverseImpact(repoId, ['d.ts']);

    expect(result.degraded).toBeUndefined();
    expect(result.files.sort()).toEqual(['b.ts', 'c.ts']);
    expect(result.files).not.toContain('a.ts');
    expect(result.files).not.toContain('d.ts'); // original changed file excluded
    expect(result.depthLimited).toBe(true);

    // Facts are attached for the visited file (c.ts) but NOT for the
    // excluded changed file (d.ts), even though d.ts has facts seeded.
    expect(result.byFile['c.ts']).toEqual({ endpoints: ['GET /c'], crons: [] });
    expect(result.byFile['d.ts']).toBeUndefined();
    expect(result.endpoints).toEqual(['GET /c']);
    expect(result.crons).toEqual([]);

    // Both visited files trace their provenance back to the single origin, d.ts.
    expect(result.originsByFile['c.ts']).toEqual(['d.ts']);
    expect(result.originsByFile['b.ts']).toEqual(['d.ts']);
  });

  it('returns a degraded empty result when repoIntelEnabled is off', async () => {
    const container = {
      config: { repoIntelEnabled: false },
      db: pg.handle.db,
    } as never;
    const offService = new RepoIntelService(container);

    const result = await offService.getReverseImpact(repoId, ['d.ts']);

    expect(result).toEqual({
      files: [],
      endpoints: [],
      crons: [],
      byFile: {},
      originsByFile: {},
      depthLimited: false,
      degraded: true,
      reason: 'flag_off',
    });
  });

  it('per-origin attribution: two unrelated changed files in one batched call do not merge their reachable sets', async () => {
    // Independent chain: x.ts -> y.ts (x imports y), unrelated to a/b/c/d.
    const [ws2] = await pg.handle.db.select().from(t.workspaces);
    const [r2] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws2!.id,
        owner: 'acme',
        name: 'reverse-impact-provenance',
        fullName: 'acme/reverse-impact-provenance',
      })
      .returning();
    const provRepoId = r2!.id;

    // Chain 1: p.ts -> q.ts (p imports q). Chain 2: x.ts -> y.ts (x imports y).
    // The two chains share no files. p.ts (importer of q.ts) has an endpoint
    // fact; x.ts's importer side has none.
    await pg.handle.db.insert(t.fileEdges).values([
      { repoId: provRepoId, fromFile: 'p.ts', toFile: 'q.ts' },
      { repoId: provRepoId, fromFile: 'x.ts', toFile: 'y.ts' },
    ]);
    await pg.handle.db.insert(t.fileFacts).values([
      { repoId: provRepoId, filePath: 'p.ts', endpoints: ['GET /p'], crons: [] },
    ]);

    const container = {
      config: { repoIntelEnabled: true },
      db: pg.handle.db,
    } as never;
    const provService = new RepoIntelService(container);

    const result = await provService.getReverseImpact(provRepoId, ['q.ts', 'y.ts']);

    expect(result.files.sort()).toEqual(['p.ts', 'x.ts']);
    // p.ts traces back to q.ts only, never to y.ts.
    expect(result.originsByFile['p.ts']).toEqual(['q.ts']);
    // x.ts traces back to y.ts only, never to q.ts.
    expect(result.originsByFile['x.ts']).toEqual(['y.ts']);
    // p.ts's endpoint fact is attributable to q.ts's origin only.
    expect(result.byFile['p.ts']).toEqual({ endpoints: ['GET /p'], crons: [] });
  });

  it('fully propagates origins through same-round interconnected changed files, regardless of row order (determinism fix)', async () => {
    // Two of the PR's own CHANGED files import each other: B.ts imports
    // A.ts. Both A.ts and B.ts are in the initial frontier (round 0), so the
    // edge B->A is discovered in the SAME `getImporters` round as the edge
    // C->A... no wait: C.ts imports B.ts (not a changed file itself), so the
    // edge C->B is ALSO returned in round 0 (frontier = [A.ts, B.ts]),
    // alongside B->A. A single linear pass over these two rows is
    // order-dependent: if C->B is processed before B->A, C.ts's origin set
    // only picks up B.ts (missing A.ts, since B.ts's own origin set hasn't
    // absorbed A.ts yet at that point). The fixed-point propagation must
    // close this gap regardless of row order.
    const [ws3] = await pg.handle.db.select().from(t.workspaces);
    const [r3] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: ws3!.id,
        owner: 'acme',
        name: 'reverse-impact-ordering',
        fullName: 'acme/reverse-impact-ordering',
      })
      .returning();
    const ordRepoId = r3!.id;

    // B.ts imports A.ts (both are changed files) — inserted in an order that
    // would surface the bug under the OLD single-pass-while-iterating code
    // if the DB happened to return C->B before B->A (row order is otherwise
    // undefined; the assertion below covers the correctness regardless of
    // whichever order Postgres actually returns them in).
    await pg.handle.db.insert(t.fileEdges).values([
      { repoId: ordRepoId, fromFile: 'C.ts', toFile: 'B.ts' },
      { repoId: ordRepoId, fromFile: 'B.ts', toFile: 'A.ts' },
    ]);

    const container = {
      config: { repoIntelEnabled: true },
      db: pg.handle.db,
    } as never;
    const ordService = new RepoIntelService(container);

    const result = await ordService.getReverseImpact(ordRepoId, ['A.ts', 'B.ts']);

    expect(result.files.sort()).toEqual(['C.ts']);
    // C.ts is reachable transitively from BOTH origins: directly from B.ts
    // (C imports B), and indirectly from A.ts (B imports A, so anything
    // downstream of B is also downstream of A). The correct transitive
    // closure includes both, not just whichever origin's edge happened to
    // be processed last.
    expect(result.originsByFile['C.ts']).toEqual(['A.ts', 'B.ts']);
  });
});
