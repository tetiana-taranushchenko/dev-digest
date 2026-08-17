import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import { SmartDiff } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[smart-diff] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

d('smart-diff module (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name: 'smart-diff-target', fullName: 'acme/smart-diff-target' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 601,
        title: 'Bump lockfile and tweak core logic',
        author: 'marisa.koch',
        branch: 'chore/bump-deps',
        base: 'main',
        headSha: 'cafebabe01',
        additions: 12,
        deletions: 4,
        filesCount: 2,
        status: 'needs_review',
      })
      .returning();
    prId = pr!.id;

    // A lockfile (always `boilerplate`, per `constants.ts`'s `LOCKFILE_NAMES`)
    // and a `core` source file that will carry the findings below.
    await pg.handle.db.insert(t.prFiles).values([
      {
        prId,
        path: 'pnpm-lock.yaml',
        additions: 8,
        deletions: 2,
        patch: '@@ -1,2 +1,2 @@\n-old\n+new',
      },
      {
        prId,
        path: 'src/service.ts',
        additions: 4,
        deletions: 2,
        patch: '@@ -8,3 +8,3 @@\n   foo(),\n+  bar(),\n   baz(),',
      },
    ]);

    // A single `kind: 'review'` row with two findings: one kept (visible in
    // `finding_lines`), one dismissed (must be excluded per REQ-5/service.ts).
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        agentId: null,
        runId: null,
        kind: 'review',
        verdict: 'comment',
        summary: 'Looks fine overall.',
        score: 80,
        model: 'gpt-4.1',
      })
      .returning();

    await pg.handle.db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/service.ts',
        startLine: 10,
        endLine: 10,
        severity: 'WARNING',
        category: 'bug',
        title: 'Kept finding',
        rationale: 'A real, non-dismissed finding.',
        confidence: 0.9,
        kind: 'finding',
      },
      {
        reviewId: review!.id,
        file: 'src/service.ts',
        startLine: 20,
        endLine: 20,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Dismissed finding',
        rationale: 'A finding the user already dismissed.',
        confidence: 0.6,
        kind: 'finding',
        dismissedAt: new Date(),
      },
    ]);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const llm = new MockLLMProvider('openai');
    return {
      llm,
      app: buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: { llm: { openai: llm } },
      }),
    };
  }

  it('assembles groups from persisted pr_files + findings, with no LLM call (REQ-6)', async () => {
    const { app: appPromise, llm } = makeApp();
    const app = await appPromise;

    const res = await app.inject({ method: 'GET', url: `/pulls/${prId}/smart-diff` });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    const smartDiff = SmartDiff.parse(body);

    // (b) pnpm-lock.yaml lands in the `boilerplate` group.
    const boilerplateGroup = smartDiff.groups.find((g) => g.role === 'boilerplate');
    expect(boilerplateGroup).toBeDefined();
    const lockfile = boilerplateGroup!.files.find((f) => f.path === 'pnpm-lock.yaml');
    expect(lockfile).toBeDefined();

    // (c) the kept finding's start_line (10) appears in that file's finding_lines.
    const coreGroup = smartDiff.groups.find((g) => g.role === 'core');
    expect(coreGroup).toBeDefined();
    const serviceFile = coreGroup!.files.find((f) => f.path === 'src/service.ts');
    expect(serviceFile).toBeDefined();
    expect(serviceFile!.finding_lines).toContain(10);

    // (d) the dismissed finding's start_line (20) does NOT appear.
    expect(serviceFile!.finding_lines).not.toContain(20);

    // (e) no LLM call was made for this route (REQ-6 — no-LLM-call guarantee).
    expect(llm.calls).toHaveLength(0);

    await app.close();
  });

  it('404s for an unknown (but valid-uuid) pull request id', async () => {
    const { app: appPromise } = makeApp();
    const app = await appPromise;

    const unknownId = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({ method: 'GET', url: `/pulls/${unknownId}/smart-diff` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('422s for a malformed (non-uuid) :id param', async () => {
    const { app: appPromise } = makeApp();
    const app = await appPromise;

    const res = await app.inject({ method: 'GET', url: '/pulls/not-a-uuid/smart-diff' });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  describe('latestPerAgent filtering across multiple agents/rows (service.ts:31-47)', () => {
    let multiPrId: string;
    // Each scenario uses its own agent id(s) — `latestPerAgent` scopes
    // "latest" per (prId, agentId) across the WHOLE pull request, not per
    // file, so reusing an agent id across scenarios would let one
    // scenario's later-inserted row silently supersede another's.
    const agentA = '11111111-1111-1111-1111-111111111111';
    const agentUnionA = '22222222-2222-2222-2222-222222222222';
    const agentUnionB = '33333333-3333-3333-3333-333333333333';
    const agentSummary = '44444444-4444-4444-4444-444444444444';

    beforeAll(async () => {
      const [repo] = await pg.handle.db
        .insert(t.repos)
        .values({ workspaceId, owner: 'acme', name: 'smart-diff-multi-agent', fullName: 'acme/smart-diff-multi-agent' })
        .returning();
      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId: repo!.id,
          number: 602,
          title: 'Multi-agent review scenarios',
          author: 'marisa.koch',
          branch: 'chore/multi-agent',
          base: 'main',
          headSha: 'deadbeef02',
          additions: 6,
          deletions: 0,
          filesCount: 3,
          status: 'needs_review',
        })
        .returning();
      multiPrId = pr!.id;

      await pg.handle.db.insert(t.prFiles).values([
        { prId: multiPrId, path: 'src/agent-a.ts', additions: 2, deletions: 0, patch: '@@ -1,1 +1,2 @@\n foo\n+bar' },
        { prId: multiPrId, path: 'src/agent-union.ts', additions: 2, deletions: 0, patch: '@@ -1,1 +1,2 @@\n foo\n+bar' },
        { prId: multiPrId, path: 'src/agent-summary.ts', additions: 2, deletions: 0, patch: '@@ -1,1 +1,2 @@\n foo\n+bar' },
      ]);

      // Scenario 1 — same agent (agentA), two `kind: 'review'` rows on
      // src/agent-a.ts. The older row's finding (line 5) must be dropped;
      // only the newer row's finding (line 6) should survive.
      const [agentAOlder] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: multiPrId,
          agentId: agentA,
          kind: 'review',
          verdict: 'comment',
          summary: 'First pass.',
          score: 70,
          model: 'gpt-4.1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        })
        .returning();
      const [agentANewer] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: multiPrId,
          agentId: agentA,
          kind: 'review',
          verdict: 'comment',
          summary: 'Re-run after push.',
          score: 90,
          model: 'gpt-4.1',
          createdAt: new Date('2026-01-02T00:00:00Z'),
        })
        .returning();

      await pg.handle.db.insert(t.findings).values([
        {
          reviewId: agentAOlder!.id,
          file: 'src/agent-a.ts',
          startLine: 5,
          endLine: 5,
          severity: 'WARNING',
          category: 'bug',
          title: 'Stale finding from an older run',
          rationale: 'Should be superseded by the newer review row for the same agent.',
          confidence: 0.8,
          kind: 'finding',
        },
        {
          reviewId: agentANewer!.id,
          file: 'src/agent-a.ts',
          startLine: 6,
          endLine: 6,
          severity: 'WARNING',
          category: 'bug',
          title: 'Fresh finding from the latest run',
          rationale: 'The current, surviving finding for this agent.',
          confidence: 0.8,
          kind: 'finding',
        },
      ]);

      // Scenario 2 — two different agents (agentUnionA, agentUnionB), each
      // with a single `kind: 'review'` row on src/agent-union.ts. Both are
      // each agent's own latest, so both findings should appear (union).
      const [agentAUnion] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: multiPrId,
          agentId: agentUnionA,
          kind: 'review',
          verdict: 'comment',
          summary: 'Agent A union pass.',
          score: 85,
          model: 'gpt-4.1',
          createdAt: new Date('2026-01-03T00:00:00Z'),
        })
        .returning();
      const [agentBUnion] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: multiPrId,
          agentId: agentUnionB,
          kind: 'review',
          verdict: 'comment',
          summary: 'Agent B union pass.',
          score: 88,
          model: 'claude-sonnet',
          createdAt: new Date('2026-01-03T00:00:00Z'),
        })
        .returning();

      await pg.handle.db.insert(t.findings).values([
        {
          reviewId: agentAUnion!.id,
          file: 'src/agent-union.ts',
          startLine: 40,
          endLine: 40,
          severity: 'SUGGESTION',
          category: 'style',
          title: "Agent A's finding",
          rationale: 'Latest (only) review row for agent A on this file.',
          confidence: 0.7,
          kind: 'finding',
        },
        {
          reviewId: agentBUnion!.id,
          file: 'src/agent-union.ts',
          startLine: 41,
          endLine: 41,
          severity: 'SUGGESTION',
          category: 'style',
          title: "Agent B's finding",
          rationale: 'Latest (only) review row for agent B on this file.',
          confidence: 0.7,
          kind: 'finding',
        },
      ]);

      // Scenario 3 — one agent (agentSummary) with both a `kind: 'summary'`
      // row and a `kind: 'review'` row on src/agent-summary.ts. Only the
      // `kind: 'review'` row's finding should participate; the summary row's
      // finding must not leak in even though it's created later.
      const [summaryRow] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: multiPrId,
          agentId: agentSummary,
          kind: 'summary',
          summary: 'High-level summary, not a line-scoped review.',
          model: 'gpt-4.1',
          createdAt: new Date('2026-01-04T00:00:00Z'),
        })
        .returning();
      const [reviewRow] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: multiPrId,
          agentId: agentSummary,
          kind: 'review',
          verdict: 'comment',
          summary: 'Line-scoped review.',
          score: 75,
          model: 'gpt-4.1',
          createdAt: new Date('2026-01-03T12:00:00Z'),
        })
        .returning();

      await pg.handle.db.insert(t.findings).values([
        {
          reviewId: summaryRow!.id,
          file: 'src/agent-summary.ts',
          startLine: 70,
          endLine: 70,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'A finding attached to a summary-kind row',
          rationale: 'Must not leak into finding_lines — only kind === review rows count.',
          confidence: 0.5,
          kind: 'finding',
        },
        {
          reviewId: reviewRow!.id,
          file: 'src/agent-summary.ts',
          startLine: 71,
          endLine: 71,
          severity: 'SUGGESTION',
          category: 'style',
          title: 'A finding attached to the review-kind row',
          rationale: 'The only finding that should surface for this agent.',
          confidence: 0.5,
          kind: 'finding',
        },
      ]);
    });

    it("keeps only the newer of two same-agent review rows' findings", async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${multiPrId}/smart-diff` });
      expect(res.statusCode).toBe(200);
      const smartDiff = SmartDiff.parse(res.json());

      const coreGroup = smartDiff.groups.find((g) => g.role === 'core');
      const file = coreGroup?.files.find((f) => f.path === 'src/agent-a.ts');
      expect(file).toBeDefined();
      expect(file!.finding_lines).toContain(6);
      expect(file!.finding_lines).not.toContain(5);

      await app.close();
    });

    it("unions each agent's latest findings across different agents", async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${multiPrId}/smart-diff` });
      expect(res.statusCode).toBe(200);
      const smartDiff = SmartDiff.parse(res.json());

      const coreGroup = smartDiff.groups.find((g) => g.role === 'core');
      const file = coreGroup?.files.find((f) => f.path === 'src/agent-union.ts');
      expect(file).toBeDefined();
      expect(file!.finding_lines).toContain(40);
      expect(file!.finding_lines).toContain(41);

      await app.close();
    });

    it("excludes a 'summary'-kind row's findings even when interleaved with a 'review' row", async () => {
      const { app: appPromise } = makeApp();
      const app = await appPromise;

      const res = await app.inject({ method: 'GET', url: `/pulls/${multiPrId}/smart-diff` });
      expect(res.statusCode).toBe(200);
      const smartDiff = SmartDiff.parse(res.json());

      const coreGroup = smartDiff.groups.find((g) => g.role === 'core');
      const file = coreGroup?.files.find((f) => f.path === 'src/agent-summary.ts');
      expect(file).toBeDefined();
      expect(file!.finding_lines).toContain(71);
      expect(file!.finding_lines).not.toContain(70);

      await app.close();
    });
  });
});
