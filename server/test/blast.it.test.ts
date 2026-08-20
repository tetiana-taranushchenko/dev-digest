/**
 * T6 — end-to-end integration test for `GET /pulls/:id/blast`, hitting the
 * real Fastify route (via `inject`) against a real Postgres (testcontainers).
 * Mirrors `smart-diff.it.test.ts`'s setup/teardown pattern.
 *
 * Covers all five assertions from docs/plans/blast-radius.md's "T6 notes":
 *   1. Indexed repo + PR touching a shared helper → `state: 'ok'`, >=2 callers
 *      in one `downstream` group, >=1 `endpoints_affected` entry.
 *   2. Same request with `ContainerOverrides.codeIndex` set to a stub whose
 *      every method throws → identical payload — proves reads come only from
 *      the persisted index tables, never the live code-index/AST path (REQ-5).
 *   3. `ContainerOverrides.llm` set to a `MockLLMProvider` → zero calls after
 *      the request (REQ-9 — no LLM calls on the main flow).
 *   4. Indexed repo, PR touching a file with no external callers →
 *      `state: 'empty'`, `reason: 'no_impact'`, non-null `reason_text`.
 *   5. Un-indexed repo (no `repo_index_state` row) → `state: 'degraded'`,
 *      `index_status: 'missing'`, non-null `reason_text` — and explicitly
 *      NOT `'empty'` (REQ-4's distinctness requirement).
 *
 * Plus a truncation regression (post architecture-reviewer audit — see
 * docs/plans/blast-radius.md "Contract changes" + T2/T4 notes): the cap used
 * to be applied twice — once inside `repo-intel/service.ts`'s
 * `tryPersistentBlast` (per `viaSymbol` group) and again inside
 * `blast/assemble.ts` (re-grouping the already-capped list) — so
 * `caller_count` could never exceed `MAX_CALLERS_PER_SYMBOL` and `truncated`
 * could never become `true` from real data reaching the real route. This
 * block drives a real PR with a symbol that has more than
 * `MAX_CALLERS_PER_SYMBOL` real resolved callers through the actual
 * `GET /pulls/:id/blast` route (not a hand-fed `assembleBlastRadius` fixture)
 * and asserts `truncated: true` with `caller_count > MAX_CALLERS_PER_SYMBOL`
 * while `callers.length === MAX_CALLERS_PER_SYMBOL`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { BlastRadius } from '@devdigest/shared';
import type { CodeIndex } from '@devdigest/shared';
import type { ContainerOverrides } from '../src/platform/container.js';
import { INDEXER_VERSION, MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[blast] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A `CodeIndex` whose every method throws. Used for assertion 2: if the
 * `/pulls/:id/blast` route ever fell back to live AST/grep reads instead of
 * the persisted index tables, injecting this would make the request fail (or
 * change shape) instead of returning the identical payload.
 */
const throwingCodeIndex: CodeIndex = {
  grep() {
    throw new Error('codeIndex.grep must not be called on the index-only blast read path');
  },
  symbols() {
    throw new Error('codeIndex.symbols must not be called on the index-only blast read path');
  },
  references() {
    throw new Error('codeIndex.references must not be called on the index-only blast read path');
  },
};

/** Strips the per-request `generated_at` timestamp before deep-equality checks. */
function withoutTimestamp(body: unknown): unknown {
  const clone = { ...(body as Record<string, unknown>) };
  delete clone.generated_at;
  return clone;
}

d('GET /pulls/:id/blast (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(overrides: ContainerOverrides = {}, configOverrides: Partial<AppConfig> = {}) {
    const llm = new MockLLMProvider('openai');
    return {
      llm,
      app: buildApp({
        config: { ...config(), ...configOverrides },
        db: pg.handle.db,
        overrides: { llm: { openai: llm }, ...overrides },
      }),
    };
  }

  describe('ok — indexed repo, PR touches a shared helper with real callers + an endpoint', () => {
    let prId: string;

    beforeAll(async () => {
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'blast-ok', fullName: 'acme/blast-ok' })
        .returning();
      const repoId = repo!.id;

      await pg.handle.db.insert(t.repoIndexState).values({
        repoId,
        lastIndexedSha: 'deadbeef',
        indexerVersion: INDEXER_VERSION,
        status: 'full',
        filesIndexed: 10,
        filesSkipped: 0,
        stats: {},
      });

      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 801,
          title: 'Touch the shared helper',
          author: 'marisa.koch',
          branch: 'feat/shared-helper',
          base: 'main',
          headSha: 'ok0001',
          additions: 3,
          deletions: 1,
          filesCount: 1,
          status: 'needs_review',
        })
        .returning();
      prId = pr!.id;

      await pg.handle.db.insert(t.prFiles).values([
        {
          prId,
          path: 'src/helpers/shared.ts',
          additions: 3,
          deletions: 1,
          patch: '@@ -1,1 +1,3 @@\n foo\n+bar\n+baz',
        },
      ]);

      await pg.handle.db.insert(t.symbols).values([
        {
          repoId,
          path: 'src/helpers/shared.ts',
          name: 'sharedHelper',
          kind: 'function',
          line: 1,
          endLine: 5,
          exported: true,
          signature: null,
          contentHash: 'h-shared',
        },
      ]);

      // Two resolved cross-file callers of `sharedHelper` — a route handler
      // (which also carries an HTTP endpoint fact) and a plain consumer.
      await pg.handle.db.insert(t.references).values([
        {
          repoId,
          fromPath: 'src/api/routes.ts',
          toSymbol: 'sharedHelper',
          line: 12,
          declFile: 'src/helpers/shared.ts',
          contentHash: 'hc-routes',
        },
        {
          repoId,
          fromPath: 'src/service/consumer.ts',
          toSymbol: 'sharedHelper',
          line: 30,
          declFile: 'src/helpers/shared.ts',
          contentHash: 'hc-consumer',
        },
      ]);

      await pg.handle.db.insert(t.fileRank).values([
        { repoId, filePath: 'src/api/routes.ts', pagerank: 1, hotness: 0, rank: 2, percentile: 90 },
        { repoId, filePath: 'src/service/consumer.ts', pagerank: 1, hotness: 0, rank: 1, percentile: 50 },
      ]);

      await pg.handle.db.insert(t.fileFacts).values([
        { repoId, filePath: 'src/api/routes.ts', endpoints: ['GET /api/items'], crons: [] },
      ]);
    });

    it('assertion 1 — returns state: ok with >=2 callers in one downstream group and >=1 endpoint', async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);

      const body = BlastRadius.parse(res.json());
      expect(body.state).toBe('ok');

      const group = body.downstream.find((s) => s.symbol === 'sharedHelper');
      expect(group).toBeDefined();
      expect(group!.callers.length).toBeGreaterThanOrEqual(2);
      expect(group!.endpoints_affected.length).toBeGreaterThanOrEqual(1);

      await app.close();
    });

    it('assertion 2 — identical payload when codeIndex is a throwing stub (index-only reads, REQ-5)', async () => {
      const { app: baselineAppPromise } = makeApp();
      const baselineApp = await baselineAppPromise;
      const baselineRes = await baselineApp.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(baselineRes.statusCode).toBe(200);
      await baselineApp.close();

      const { app: brokenAppPromise } = makeApp({ codeIndex: throwingCodeIndex });
      const brokenApp = await brokenAppPromise;
      const brokenRes = await brokenApp.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(brokenRes.statusCode).toBe(200);
      await brokenApp.close();

      expect(withoutTimestamp(brokenRes.json())).toEqual(withoutTimestamp(baselineRes.json()));
    });

    it('assertion 3 — makes zero LLM calls on the main flow (REQ-9)', async () => {
      const { app: appPromise, llm } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);
      expect(llm.calls).toHaveLength(0);

      await app.close();
    });

    /**
     * Second architecture-reviewer audit pass (HIGH): the `deriveIndexStatus`
     * gate in `blast/service.ts` only checked index HEALTH, not whether
     * `config.repoIntelEnabled` is on. This repo has a HEALTHY `status: 'full'`
     * index row (seeded above), so the health-only gate alone would say
     * "usable, proceed" — but with `repoIntelEnabled: false`,
     * `RepoIntelService.getBlastRadius`'s own guard (repo-intel/service.ts:224)
     * skips its persistent-index branch and falls through to the live
     * ripgrep/AST scan regardless of index health. `blast/service.ts` must now
     * treat "flag off" the same as "index unusable" and skip the facade calls
     * entirely — proven here by injecting a throwing `codeIndex` stub: if the
     * live-scan path were ever reached, the request would throw/500 instead of
     * returning a clean degraded payload.
     */
    it('repoIntelEnabled: false with a healthy index — skips the live scan and returns a degraded payload (REQ-5)', async () => {
      const { app: appPromise } = makeApp({ codeIndex: throwingCodeIndex }, { repoIntelEnabled: false });
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);

      const body = BlastRadius.parse(res.json());
      expect(body.state).toBe('degraded');

      await app.close();
    });

    /**
     * T4 (`docs/plans/blast-radius-prior-prs.md`) assertions 2 and 3 — a
     * healthy repo where no other PR touches `src/helpers/shared.ts` (no such
     * PR is seeded in this `describe`'s `beforeAll`) must report `prior_prs:
     * []`, not a degraded/empty signal: `state` stays `'ok'` exactly as
     * assertion 1 above. Also asserts zero LLM calls (REQ-6) via the
     * `MockLLMProvider` `makeApp` already wires in.
     */
    it('prior_prs is [] when no other PR overlaps, state stays ok, and zero LLM calls are made (REQ-5, REQ-6)', async () => {
      const { app: appPromise, llm } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);

      const body = BlastRadius.parse(res.json());
      expect(body.state).toBe('ok');
      expect(body.prior_prs).toEqual([]);
      expect(llm.calls).toHaveLength(0);

      await app.close();
    });
  });

  describe('empty — indexed repo, PR touches a file with no external callers', () => {
    let prId: string;

    beforeAll(async () => {
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'blast-empty', fullName: 'acme/blast-empty' })
        .returning();
      const repoId = repo!.id;

      await pg.handle.db.insert(t.repoIndexState).values({
        repoId,
        lastIndexedSha: 'cafef00d',
        indexerVersion: INDEXER_VERSION,
        status: 'full',
        filesIndexed: 3,
        filesSkipped: 0,
        stats: {},
      });

      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 802,
          title: 'Touch an isolated file',
          author: 'marisa.koch',
          branch: 'chore/isolated',
          base: 'main',
          headSha: 'empty001',
          additions: 2,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
        })
        .returning();
      prId = pr!.id;

      await pg.handle.db.insert(t.prFiles).values([
        {
          prId,
          path: 'src/isolated/lonely.ts',
          additions: 2,
          deletions: 0,
          patch: '@@ -0,0 +1,2 @@\n+foo\n+bar',
        },
      ]);

      await pg.handle.db.insert(t.symbols).values([
        {
          repoId,
          path: 'src/isolated/lonely.ts',
          name: 'lonelyFn',
          kind: 'function',
          line: 1,
          endLine: 2,
          exported: true,
          signature: null,
          contentHash: 'h-lonely',
        },
      ]);
      // Deliberately no `references`, `file_facts`, or `file_edges` rows —
      // the index is fine, there is genuinely no downstream impact.
    });

    it('assertion 4 — returns state: empty, reason: no_impact, non-null reason_text', async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);

      const body = BlastRadius.parse(res.json());
      expect(body.state).toBe('empty');
      expect(body.reason).toBe('no_impact');
      expect(body.reason_text).toBeTruthy();

      await app.close();
    });
  });

  describe('degraded — un-indexed repo (no repo_index_state row at all)', () => {
    let prId: string;

    beforeAll(async () => {
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'blast-unindexed', fullName: 'acme/blast-unindexed' })
        .returning();
      const repoId = repo!.id;

      // Deliberately no `repo_index_state` row for this repo — an unusable
      // index, not a genuinely-empty one (REQ-4).

      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 803,
          title: 'PR against an unindexed repo',
          author: 'marisa.koch',
          branch: 'chore/unindexed',
          base: 'main',
          headSha: 'degrade1',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
        })
        .returning();
      prId = pr!.id;

      await pg.handle.db.insert(t.prFiles).values([
        { prId, path: 'src/whatever.ts', additions: 1, deletions: 0, patch: '@@ -0,0 +1,1 @@\n+foo' },
      ]);

      // A second, real PR in this SAME (un-indexed) repo that touches the
      // same path — used by the "prior PRs survive a degraded index" (T4,
      // REQ-5) assertion below.
      const [priorPr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 806,
          title: 'Earlier change to src/whatever.ts',
          author: 'marisa.koch',
          branch: 'chore/earlier-whatever',
          base: 'main',
          headSha: 'degrade0',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
        })
        .returning();
      await pg.handle.db.insert(t.prFiles).values([
        {
          prId: priorPr!.id,
          path: 'src/whatever.ts',
          additions: 1,
          deletions: 0,
          patch: '@@ -0,0 +1,1 @@\n+bar',
        },
      ]);
    });

    it('assertion 5 — returns state: degraded, index_status: missing, non-null reason_text, never empty', async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);

      const body = BlastRadius.parse(res.json());
      expect(body.state).toBe('degraded');
      expect(body.state).not.toBe('empty');
      expect(body.index_status).toBe('missing');
      expect(body.reason_text).toBeTruthy();

      await app.close();
    });

    /**
     * REQ-5 regression (post architecture-reviewer audit, HIGH): `BlastService.get`
     * used to call `getBlastRadius` in parallel with `getIndexState`, so on an
     * un-indexed-but-cloned repo it would always fall through to
     * `RepoIntelService`'s ripgrep fallback — a full filesystem walk +
     * regex re-parse of the clone, synchronously inside the request handler.
     * That is real request-time AST/import-graph recomputation, which REQ-5
     * forbids. `getIndexState` is now awaited FIRST, and the expensive
     * `codeIndex`-backed live-scan path is skipped entirely whenever the index
     * is missing/degraded/failed. Proof: inject a `codeIndex` stub whose every
     * method throws — the request must not throw or hang, and must return the
     * identical degraded payload as the baseline, proving `codeIndex.symbols`/
     * `references` are never invoked on this path.
     */
    it('degraded/missing-index — identical payload with a throwing codeIndex stub (proves the live-scan path is never invoked, REQ-5)', async () => {
      const { app: baselineAppPromise } = makeApp();
      const baselineApp = await baselineAppPromise;
      const baselineRes = await baselineApp.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(baselineRes.statusCode).toBe(200);
      await baselineApp.close();

      const { app: brokenAppPromise } = makeApp({ codeIndex: throwingCodeIndex });
      const brokenApp = await brokenAppPromise;
      const brokenRes = await brokenApp.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(brokenRes.statusCode).toBe(200);
      await brokenApp.close();

      expect(withoutTimestamp(brokenRes.json())).toEqual(withoutTimestamp(baselineRes.json()));

      const brokenBody = BlastRadius.parse(brokenRes.json());
      expect(brokenBody.state).toBe('degraded');
      expect(brokenBody.index_status).toBe('missing');
    });

    /**
     * T4 (`docs/plans/blast-radius-prior-prs.md`) assertion 1 — "prior PRs"
     * is plain reference data read via `reviewRepo`, not the repo-intel
     * index, so it must survive a degraded/missing index untouched (REQ-5):
     * `state`/`index_status` stay exactly as assertion 5 above, while
     * `prior_prs` still surfaces the real overlapping PR seeded in this
     * `beforeAll` (number 806, sharing `src/whatever.ts`).
     */
    it('prior_prs still surfaces a real overlapping PR even though the index is degraded/missing (REQ-5)', async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);

      const body = BlastRadius.parse(res.json());
      expect(body.state).toBe('degraded');
      expect(body.index_status).toBe('missing');

      expect(body.prior_prs).toHaveLength(1);
      expect(body.prior_prs![0]!.number).toBe(806);
      expect(body.prior_prs![0]!.title).toBe('Earlier change to src/whatever.ts');

      await app.close();
    });
  });

  describe('truncated — indexed repo, PR touches a symbol with more than MAX_CALLERS_PER_SYMBOL real callers', () => {
    let prId: string;
    const totalCallers = MAX_CALLERS_PER_SYMBOL + 5;

    beforeAll(async () => {
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'blast-truncated', fullName: 'acme/blast-truncated' })
        .returning();
      const repoId = repo!.id;

      await pg.handle.db.insert(t.repoIndexState).values({
        repoId,
        lastIndexedSha: 'trunc001',
        indexerVersion: INDEXER_VERSION,
        status: 'full',
        filesIndexed: totalCallers + 1,
        filesSkipped: 0,
        stats: {},
      });

      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 804,
          title: 'Touch a very popular helper',
          author: 'marisa.koch',
          branch: 'feat/popular-helper',
          base: 'main',
          headSha: 'trunc0001',
          additions: 2,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
        })
        .returning();
      prId = pr!.id;

      await pg.handle.db.insert(t.prFiles).values([
        {
          prId,
          path: 'src/helpers/popular.ts',
          additions: 2,
          deletions: 0,
          patch: '@@ -1,1 +1,2 @@\n foo\n+bar',
        },
      ]);

      await pg.handle.db.insert(t.symbols).values([
        {
          repoId,
          path: 'src/helpers/popular.ts',
          name: 'popularHelper',
          kind: 'function',
          line: 1,
          endLine: 5,
          exported: true,
          signature: null,
          contentHash: 'h-popular',
        },
      ]);

      // MAX_CALLERS_PER_SYMBOL + 5 distinct real resolved callers, each from
      // its own file with its own fileRank row (required by the inner join
      // in `getResolvedCallers`), so the true pre-cap count is > the cap.
      const referenceRows: (typeof t.references.$inferInsert)[] = [];
      const fileRankRows: (typeof t.fileRank.$inferInsert)[] = [];
      for (let i = 0; i < totalCallers; i += 1) {
        const fromPath = `src/caller-popular-${String(i).padStart(2, '0')}.ts`;
        referenceRows.push({
          repoId,
          fromPath,
          toSymbol: 'popularHelper',
          line: 10 + i,
          declFile: 'src/helpers/popular.ts',
          contentHash: `hc-popular-${i}`,
        });
        fileRankRows.push({
          repoId,
          filePath: fromPath,
          pagerank: i,
          hotness: 0,
          rank: i,
          percentile: i,
        });
      }
      await pg.handle.db.insert(t.references).values(referenceRows);
      await pg.handle.db.insert(t.fileRank).values(fileRankRows);
    });

    it('returns truncated: true with the true caller_count and callers capped at MAX_CALLERS_PER_SYMBOL', async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);

      const body = BlastRadius.parse(res.json());
      expect(body.truncated).toBe(true);

      const group = body.downstream.find((s) => s.symbol === 'popularHelper');
      expect(group).toBeDefined();
      expect(group!.caller_count).toBeGreaterThan(MAX_CALLERS_PER_SYMBOL);
      expect(group!.caller_count).toBe(totalCallers);
      expect(group!.callers.length).toBe(MAX_CALLERS_PER_SYMBOL);

      await app.close();
    });
  });

  describe('per-origin attribution — two changed-file symbols, only one reaches a reverse-impact endpoint', () => {
    let prId: string;

    // architecture-reviewer MEDIUM fix regression: `GET /pulls/:id/blast`
    // calls `getReverseImpact` exactly ONCE over the whole PR's changed-file
    // list (`src/a.ts` + `src/z.ts` together), not once per symbol. Before
    // the fix, `assemble.ts` applied the entire batched `reverse.files` set
    // to every changed symbol, so BOTH `symbolA` and `symbolZ` would show
    // the endpoint reachable only from `symbolZ`'s declaring file. This test
    // drives that scenario through the real route end-to-end.
    beforeAll(async () => {
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'blast-per-origin', fullName: 'acme/blast-per-origin' })
        .returning();
      const repoId = repo!.id;

      await pg.handle.db.insert(t.repoIndexState).values({
        repoId,
        lastIndexedSha: 'perorigin1',
        indexerVersion: INDEXER_VERSION,
        status: 'full',
        filesIndexed: 5,
        filesSkipped: 0,
        stats: {},
      });

      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 805,
          title: 'Touch two unrelated symbols',
          author: 'marisa.koch',
          branch: 'feat/two-unrelated-symbols',
          base: 'main',
          headSha: 'perorigin0001',
          additions: 4,
          deletions: 0,
          filesCount: 2,
          status: 'needs_review',
        })
        .returning();
      prId = pr!.id;

      await pg.handle.db.insert(t.prFiles).values([
        { prId, path: 'src/a.ts', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+foo\n+bar' },
        { prId, path: 'src/z.ts', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+foo\n+bar' },
      ]);

      await pg.handle.db.insert(t.symbols).values([
        {
          repoId,
          path: 'src/a.ts',
          name: 'symbolA',
          kind: 'function',
          line: 1,
          endLine: 3,
          exported: true,
          signature: null,
          contentHash: 'h-a',
        },
        {
          repoId,
          path: 'src/z.ts',
          name: 'symbolZ',
          kind: 'function',
          line: 1,
          endLine: 3,
          exported: true,
          signature: null,
          contentHash: 'h-z',
        },
      ]);

      // Both symbols get one real resolved caller each, so neither downstream
      // group is empty (state stays 'ok', not 'empty').
      await pg.handle.db.insert(t.references).values([
        {
          repoId,
          fromPath: 'src/a-caller.ts',
          toSymbol: 'symbolA',
          line: 5,
          declFile: 'src/a.ts',
          contentHash: 'hc-a-caller',
        },
        {
          repoId,
          fromPath: 'src/z-caller.ts',
          toSymbol: 'symbolZ',
          line: 5,
          declFile: 'src/z.ts',
          contentHash: 'hc-z-caller',
        },
      ]);
      await pg.handle.db.insert(t.fileRank).values([
        { repoId, filePath: 'src/a-caller.ts', pagerank: 1, hotness: 0, rank: 1, percentile: 50 },
        { repoId, filePath: 'src/z-caller.ts', pagerank: 1, hotness: 0, rank: 1, percentile: 50 },
      ]);

      // Reverse import-graph edge: ONLY src/z.ts is upstream of an HTTP
      // route (src/routes/z-route.ts imports src/z.ts). src/a.ts has no
      // importers at all — it is not upstream of anything.
      await pg.handle.db.insert(t.fileEdges).values([
        { repoId, fromFile: 'src/routes/z-route.ts', toFile: 'src/z.ts' },
      ]);
      await pg.handle.db.insert(t.fileFacts).values([
        { repoId, filePath: 'src/routes/z-route.ts', endpoints: ['GET /api/z-only'], crons: [] },
      ]);
    });

    it('only symbolZ (declared in src/z.ts) shows the reverse-impact endpoint; symbolA does not', async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/blast` });
      expect(res.statusCode).toBe(200);

      const body = BlastRadius.parse(res.json());
      expect(body.state).toBe('ok');

      const symbolA = body.downstream.find((s) => s.symbol === 'symbolA');
      const symbolZ = body.downstream.find((s) => s.symbol === 'symbolZ');
      expect(symbolA).toBeDefined();
      expect(symbolZ).toBeDefined();

      expect(symbolZ!.endpoints_affected).toEqual(['GET /api/z-only']);
      expect(symbolA!.endpoints_affected).toEqual([]);

      await app.close();
    });
  });
});
