/**
 * T2 — integration test for `ReviewRepository.getPriorPrsTouchingFiles`
 * (`server/src/modules/reviews/repository/pull.repo.ts`), which backs the
 * Blast Radius "Prior PRs touching these files" reference row
 * (`docs/plans/blast-radius-prior-prs.md`). Hits a real Postgres
 * (testcontainers), calling the repository directly — this is
 * infrastructure-layer coverage, not a route test.
 *
 * Covers all 6 assertions from the plan's T2 notes:
 *   1. A prior PR touching two of the current PR's paths appears once (dedupe).
 *   2. A PR whose only file is outside the current PR's paths is absent.
 *   3. The current PR itself is absent (even though its own files match its
 *      own paths — proves `excludePrId` filtering, not just "no self-join").
 *   4. PRs outside either tenant boundary are absent: a different repo in the
 *      same workspace, and a different workspace paired with the same repo id
 *      (REQ-8).
 *   5. The cap, newest-first ordering, deterministic number tie-break, and
 *      explicit `updatedAt: null` last ordering are all preserved.
 *   6. `paths: []` returns `[]`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[blast-prior-prs] Docker not available — skipping integration tests.');
}

d('ReviewRepository.getPriorPrsTouchingFiles (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repo: ReviewRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    repo = new ReviewRepository(pg.handle.db);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  describe('dedupe / exclusion / scoping', () => {
    let repoId: string;
    let curPrId: string;
    let priorDedupeNumber: number;
    let priorOutsideNumber: number;
    let curPrNumber: number;
    let crossRepoNumber: number;
    let crossWorkspaceNumber: number;

    beforeAll(async () => {
      const [r] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'prior-prs-main', fullName: 'acme/prior-prs-main' })
        .returning();
      repoId = r!.id;

      const [otherRepo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'prior-prs-other', fullName: 'acme/prior-prs-other' })
        .returning();
      const otherRepoId = otherRepo!.id;

      const [curPr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 901,
          title: 'Current PR',
          author: 'marisa.koch',
          branch: 'feat/current',
          base: 'main',
          headSha: 'cur00001',
          additions: 4,
          deletions: 0,
          filesCount: 2,
          status: 'needs_review',
          updatedAt: new Date('2024-01-10T00:00:00Z'),
        })
        .returning();
      curPrId = curPr!.id;
      curPrNumber = curPr!.number;

      await pg.handle.db.insert(t.prFiles).values([
        { prId: curPrId, path: 'src/a.ts', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+foo\n+bar' },
        { prId: curPrId, path: 'src/b.ts', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+foo\n+bar' },
      ]);

      // Touches BOTH of the current PR's paths — must dedupe to one row.
      const [priorDedupe] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 902,
          title: 'Prior PR touching both files',
          author: 'marisa.koch',
          branch: 'feat/prior-dedupe',
          base: 'main',
          headSha: 'prior0001',
          additions: 3,
          deletions: 1,
          filesCount: 2,
          status: 'needs_review',
          updatedAt: new Date('2024-01-05T00:00:00Z'),
        })
        .returning();
      priorDedupeNumber = priorDedupe!.number;
      await pg.handle.db.insert(t.prFiles).values([
        { prId: priorDedupe!.id, path: 'src/a.ts', additions: 1, deletions: 0, patch: null },
        { prId: priorDedupe!.id, path: 'src/b.ts', additions: 2, deletions: 1, patch: null },
      ]);

      // Only touches a file outside the current PR's paths — must be absent.
      const [priorOutside] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 903,
          title: 'Prior PR touching an unrelated file',
          author: 'marisa.koch',
          branch: 'feat/prior-outside',
          base: 'main',
          headSha: 'prior0002',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
          updatedAt: new Date('2024-01-06T00:00:00Z'),
        })
        .returning();
      priorOutsideNumber = priorOutside!.number;
      await pg.handle.db
        .insert(t.prFiles)
        .values([{ prId: priorOutside!.id, path: 'src/other.ts', additions: 1, deletions: 0, patch: null }]);

      // Same path, different repo (same workspace) — must be absent (REQ-8).
      const [crossRepoPr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId: otherRepoId,
          number: 950,
          title: 'PR in a different repo touching the same path',
          author: 'marisa.koch',
          branch: 'feat/cross-repo',
          base: 'main',
          headSha: 'cross0001',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
          updatedAt: new Date('2024-01-09T00:00:00Z'),
        })
        .returning();
      crossRepoNumber = crossRepoPr!.number;
      await pg.handle.db
        .insert(t.prFiles)
        .values([{ prId: crossRepoPr!.id, path: 'src/a.ts', additions: 1, deletions: 0, patch: null }]);

      // Same repo id and path, but a different workspace. The schema's two
      // independent FKs permit this deliberately adversarial row, so this is
      // the case that proves the query applies workspaceId in addition to
      // repoId instead of relying on normal importer invariants (REQ-8).
      const [otherWorkspace] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: 'prior-prs-other-workspace' })
        .returning();
      const [crossWorkspacePr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId: otherWorkspace!.id,
          repoId,
          number: 951,
          title: 'PR in another workspace paired with the same repo',
          author: 'marisa.koch',
          branch: 'feat/cross-workspace',
          base: 'main',
          headSha: 'crossws01',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
          updatedAt: new Date('2024-01-09T12:00:00Z'),
        })
        .returning();
      crossWorkspaceNumber = crossWorkspacePr!.number;
      await pg.handle.db
        .insert(t.prFiles)
        .values([{ prId: crossWorkspacePr!.id, path: 'src/a.ts', additions: 1, deletions: 0, patch: null }]);
    });

    it('dedupes a PR touching two matching paths into one row, excludes an unrelated PR, the current PR itself, and a same-path PR from a different repo', async () => {
      const rows = await repo.getPriorPrsTouchingFiles({
        workspaceId,
        repoId,
        excludePrId: curPrId,
        paths: ['src/a.ts', 'src/b.ts'],
        limit: 10,
      });

      // Assertion 1: dedupe — appears exactly once.
      const dedupeMatches = rows.filter((row) => row.number === priorDedupeNumber);
      expect(dedupeMatches).toHaveLength(1);

      // Assertion 2: PR whose only file is outside the paths is absent.
      expect(rows.some((row) => row.number === priorOutsideNumber)).toBe(false);

      // Assertion 3: the current PR itself is absent.
      expect(rows.some((row) => row.number === curPrNumber)).toBe(false);

      // Assertion 4: a same-path PR from a different repo is absent.
      expect(rows.some((row) => row.number === crossRepoNumber)).toBe(false);

      // REQ-8's other tenant boundary: same repo id, different workspace.
      expect(rows.some((row) => row.number === crossWorkspaceNumber)).toBe(false);
    });
  });

  describe('ordering, null-last, and limit', () => {
    let repoId: string;
    let curPrId: string;
    let newerNumber: number;
    let sameTimestampHigherNumber: number;
    let olderNumber: number;
    let nullUpdatedNumber: number;

    beforeAll(async () => {
      const [r] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'prior-prs-order', fullName: 'acme/prior-prs-order' })
        .returning();
      repoId = r!.id;

      const [curPr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 920,
          title: 'Current PR (order test)',
          author: 'marisa.koch',
          branch: 'feat/current-order',
          base: 'main',
          headSha: 'orderc001',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
        })
        .returning();
      curPrId = curPr!.id;

      await pg.handle.db
        .insert(t.prFiles)
        .values([{ prId: curPrId, path: 'src/order.ts', additions: 1, deletions: 0, patch: null }]);

      const [newer] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 921,
          title: 'Newest prior PR',
          author: 'marisa.koch',
          branch: 'feat/order-newer',
          base: 'main',
          headSha: 'order0001',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
          updatedAt: new Date('2024-03-01T00:00:00Z'),
        })
        .returning();
      newerNumber = newer!.number;
      await pg.handle.db
        .insert(t.prFiles)
        .values([{ prId: newer!.id, path: 'src/order.ts', additions: 1, deletions: 0, patch: null }]);

      // Same updated_at as `newer`, but a higher PR number — proves the
      // deterministic secondary ordering rather than relying on row order.
      const [sameTimestampHigher] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 924,
          title: 'Same timestamp, higher PR number',
          author: 'marisa.koch',
          branch: 'feat/order-tie-break',
          base: 'main',
          headSha: 'order0004',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
          updatedAt: new Date('2024-03-01T00:00:00Z'),
        })
        .returning();
      sameTimestampHigherNumber = sameTimestampHigher!.number;
      await pg.handle.db
        .insert(t.prFiles)
        .values([{ prId: sameTimestampHigher!.id, path: 'src/order.ts', additions: 1, deletions: 0, patch: null }]);

      const [older] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 922,
          title: 'Older prior PR',
          author: 'marisa.koch',
          branch: 'feat/order-older',
          base: 'main',
          headSha: 'order0002',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
          updatedAt: new Date('2024-02-01T00:00:00Z'),
        })
        .returning();
      olderNumber = older!.number;
      await pg.handle.db
        .insert(t.prFiles)
        .values([{ prId: older!.id, path: 'src/order.ts', additions: 1, deletions: 0, patch: null }]);

      // Matches, but has no `updated_at` — must sort LAST, not first.
      const [nullUpdated] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 923,
          title: 'Prior PR with no updated_at',
          author: 'marisa.koch',
          branch: 'feat/order-null',
          base: 'main',
          headSha: 'order0003',
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'needs_review',
          // updatedAt intentionally omitted (nullable column).
        })
        .returning();
      nullUpdatedNumber = nullUpdated!.number;
      await pg.handle.db
        .insert(t.prFiles)
        .values([{ prId: nullUpdated!.id, path: 'src/order.ts', additions: 1, deletions: 0, patch: null }]);
    });

    it('assertion 5 — applies the cap after updatedAt desc, number desc tie-breaking, with null updatedAt last', async () => {
      const rows = await repo.getPriorPrsTouchingFiles({
        workspaceId,
        repoId,
        excludePrId: curPrId,
        paths: ['src/order.ts'],
        limit: 3,
      });

      expect(rows.map((row) => row.number)).toEqual([sameTimestampHigherNumber, newerNumber, olderNumber]);
      expect(rows.some((row) => row.number === nullUpdatedNumber)).toBe(false);
    });

    it('assertion 6 — paths: [] returns []', async () => {
      const rows = await repo.getPriorPrsTouchingFiles({
        workspaceId,
        repoId,
        excludePrId: curPrId,
        paths: [],
        limit: 10,
      });

      expect(rows).toEqual([]);
    });
  });
});
