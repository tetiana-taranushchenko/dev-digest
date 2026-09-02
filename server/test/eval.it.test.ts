import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Finding, Review, StructuredRequest, StructuredResult } from '@devdigest/shared';
import { EVAL_RUN_TASK } from '../src/modules/eval/constants.js';

/**
 * T7 — eval module integration tests (Testcontainers Postgres, real routes +
 * repository + scoring + dashboard aggregation + bulk-run tracker). Covers
 * every AC named in the plan's "T7 must cover" paragraph. Unit-level scoring
 * math/dashboard math/tracker mechanics are already covered by T2/T3/T4's
 * `*.test.ts` files — this file exercises the module end-to-end through
 * `app.inject`, the way `reviews.it.test.ts`/`skills.it.test.ts` do.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A unified diff touching src/config.ts (line 11 added) — same fixture shape
 *  as reviews.it.test.ts's DIFF, reused here so a produced finding at line 11
 *  survives the citation-grounding gate. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A produced finding at the one line the DIFF actually touches. */
const MATCHED_FINDING: Finding = {
  id: 'f-match',
  severity: 'CRITICAL',
  category: 'security',
  title: 'Hardcoded Stripe secret key',
  file: 'src/config.ts',
  start_line: 11,
  end_line: 11,
  rationale: 'A live Stripe key is committed in source.',
  confidence: 0.9,
  kind: 'finding',
};

function reviewFixture(findings: Finding[] = []): Review {
  return { verdict: findings.length ? 'request_changes' : 'approve', summary: 'eval fixture', score: 90, findings };
}

const SKILL_BODY = {
  name: 'No hardcoded secrets',
  description: 'Flag literal secrets in a diff.',
  type: 'security' as const,
  source: 'manual' as const,
  body: 'Look for hardcoded API keys/tokens in added lines.',
};

d('eval module (T7)', () => {
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

  function appWithProvider(llm: MockLLMProvider, provider: 'openai' | 'anthropic' = 'openai') {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ diff: DIFF }),
        llm: { [provider]: llm },
      },
    });
  }

  function appWith(structured: Review, provider: 'openai' | 'anthropic' = 'openai') {
    return appWithProvider(new MockLLMProvider(provider, { structured }), provider);
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, overrides: Record<string, unknown> = {}) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Eval Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
        ...overrides,
      },
    });
    return res.json() as { id: string; enabled: boolean };
  }

  let repoSeq = 0;
  async function setupRepoAndPr(db: PgFixture['handle']['db'], ws: string) {
    const name = `eval-repo-${repoSeq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 900 + repoSeq,
        title: 'Eval seed PR',
        author: 'evaluator',
        branch: 'feat/eval',
        base: 'main',
        headSha: 'deadbeef',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'seed pr',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  async function insertReviewAndFinding(
    db: PgFixture['handle']['db'],
    opts: {
      prId: string;
      agentId: string | null;
      file: string;
      startLine: number;
      endLine: number;
      dismissed: boolean;
    },
  ) {
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: opts.prId,
        agentId: opts.agentId,
        kind: 'review',
        verdict: 'request_changes',
        summary: 'seed review',
        score: 50,
        model: 'gpt-4.1',
      })
      .returning();
    const [finding] = await db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: opts.file,
        startLine: opts.startLine,
        endLine: opts.endLine,
        severity: 'WARNING',
        category: 'bug',
        title: 'Seed finding',
        rationale: 'r',
        confidence: 0.8,
        kind: 'finding',
        dismissedAt: opts.dismissed ? new Date() : null,
      })
      .returning();
    return { review: review!, finding: finding! };
  }

  async function pollBatch(
    app: Awaited<ReturnType<typeof buildApp>>,
    batchId: string,
    timeoutMs = 20_000,
  ): Promise<{ status: string; completed: number; total: number; results: unknown[]; errors: { case_id: string; message: string }[] }> {
    const start = Date.now();
    for (;;) {
      const res = await app.inject({ method: 'GET', url: `/eval-cases/run-all/${batchId}` });
      const body = res.json();
      if (body.status === 'done') return body;
      if (Date.now() - start > timeoutMs) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  // ===========================================================================
  // CRUD + workspace isolation (AC-2, AC-4)
  // ===========================================================================

  it('workspace isolation: a case in another workspace is invisible and undeletable (AC-2, AC-4)', async () => {
    const app = await appWith(reviewFixture());
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: `other-eval-ws-${randomUUID()}` }).returning();
    const [foreign] = await db
      .insert(t.evalCases)
      .values({
        workspaceId: otherWs!.id,
        ownerKind: 'agent',
        ownerId: randomUUID(),
        name: 'foreign case',
        expectedOutput: [],
      })
      .returning();

    const getRes = await app.inject({ method: 'GET', url: `/eval-cases/${foreign!.id}` });
    expect(getRes.statusCode).toBe(404);

    const deleteRes = await app.inject({ method: 'DELETE', url: `/eval-cases/${foreign!.id}` });
    expect(deleteRes.statusCode).toBe(404);

    const list = (await app.inject({ method: 'GET', url: '/eval-cases' })).json();
    expect(list.some((c: { id: string }) => c.id === foreign!.id)).toBe(false);

    const stillThere = await db.select().from(t.evalCases).where(eq(t.evalCases.id, foreign!.id));
    expect(stillThere).toHaveLength(1);

    await app.close();
  });

  // ===========================================================================
  // Invalid owner_id (AC-3)
  // ===========================================================================

  it('rejects an invalid owner_id (non-uuid, non-existent, wrong-kind) and persists nothing (AC-3)', async () => {
    const app = await appWith(reviewFixture());
    const { db } = pg.handle;
    const skill = (await app.inject({ method: 'POST', url: '/skills', payload: SKILL_BODY })).json();

    const before = await db.select().from(t.evalCases).where(eq(t.evalCases.workspaceId, workspaceId));

    const nonUuid = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { owner_kind: 'agent', owner_id: 'not-a-uuid', name: 'bad-1', expected_output: [] },
    });
    expect(nonUuid.statusCode).toBe(422);

    const nonExistent = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { owner_kind: 'agent', owner_id: randomUUID(), name: 'bad-2', expected_output: [] },
    });
    expect(nonExistent.statusCode).toBe(404);

    const wrongKind = await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { owner_kind: 'agent', owner_id: skill.id, name: 'bad-3', expected_output: [] },
    });
    expect(wrongKind.statusCode).toBe(404);

    const after = await db.select().from(t.evalCases).where(eq(t.evalCases.workspaceId, workspaceId));
    expect(after).toHaveLength(before.length);

    await app.close();
  });

  // ===========================================================================
  // Cascade delete (AC-5)
  // ===========================================================================

  it('deleting a case cascades its runs (AC-5)', async () => {
    const app = await appWith(reviewFixture([MATCHED_FINDING]));
    const { db } = pg.handle;
    const agent = await createAgent(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'cascade-case',
          input_diff: DIFF,
          expected_output: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }],
        },
      })
    ).json();

    await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });

    const runsBefore = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, created.id));
    expect(runsBefore.length).toBeGreaterThan(0);

    const del = await app.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
    expect(del.statusCode).toBe(200);

    const runsAfter = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, created.id));
    expect(runsAfter).toHaveLength(0);

    await app.close();
  });

  // ===========================================================================
  // Scoring: recall/precision/pass, degenerate 0/0 (AC-7, AC-9, AC-11, AC-37)
  // ===========================================================================

  it('runs a case: recall and precision are computed independently (AC-7, AC-9)', async () => {
    const app = await appWith(reviewFixture([MATCHED_FINDING]));
    const { db } = pg.handle;
    const agent = await createAgent(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'partial-match',
          input_diff: DIFF,
          expected_output: [
            { file: 'src/config.ts', start_line: 11, end_line: 11 },
            { file: 'src/config.ts', start_line: 999, end_line: 999 },
          ],
        },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.recall).toBe(0.5);
    expect(body.result.precision).toBe(1);
    expect(body.result.traces_total).toBe(2);
    expect(body.result.traces_passed).toBe(1);

    // `pass` isn't part of the frozen `EvalRun` response contract — it's
    // persisted (AC-11) and read back off the row instead.
    const [run] = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, created.id));
    expect(run!.pass).toBe(false);

    await app.close();
  });

  it('degenerate 0 expected / 0 produced both persist as pass with recall=precision=1 (AC-11, AC-37)', async () => {
    const app = await appWith(reviewFixture([]));
    const { db } = pg.handle;
    const agent = await createAgent(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: { owner_kind: 'agent', owner_id: agent.id, name: 'degenerate', input_diff: DIFF, expected_output: [] },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    const body = res.json();
    expect(body.result.recall).toBe(1);
    expect(body.result.precision).toBe(1);
    expect(body.result.traces_total).toBe(0);

    const [run] = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, created.id));
    expect(run!.pass).toBe(true);

    await app.close();
  });

  it('matches purely on file + overlapping line range, ignoring severity/category mismatches (AC-8, AC-44)', async () => {
    const app = await appWith(reviewFixture([MATCHED_FINDING])); // severity CRITICAL, category security
    const { db } = pg.handle;
    const agent = await createAgent(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'mismatch-ok',
          input_diff: DIFF,
          expected_output: [{ file: 'src/config.ts', start_line: 11, end_line: 11, severity: 'SUGGESTION', category: 'style' }],
        },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    const body = res.json();
    expect(body.result.recall).toBe(1);

    const [run] = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, created.id));
    expect(run!.pass).toBe(true);

    await app.close();
  });

  // ===========================================================================
  // Malformed expected_output (AC-12)
  // ===========================================================================

  it('rejects an unparseable expected_output and persists no run row (AC-12)', async () => {
    const app = await appWith(reviewFixture());
    const { db } = pg.handle;
    const agent = await createAgent(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'bad-expected',
          input_diff: DIFF,
          expected_output: [{ not_a_valid_shape: true }],
        },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    expect(res.statusCode).toBe(422);

    const runs = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, created.id));
    expect(runs).toHaveLength(0);

    await app.close();
  });

  // ===========================================================================
  // citation_accuracy null-vs-1 split (AC-38)
  // ===========================================================================

  it('a run producing zero findings persists a null citation_accuracy, response reports 1 (AC-38)', async () => {
    const app = await appWith(reviewFixture([]));
    const { db } = pg.handle;
    const agent = await createAgent(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'zero-findings',
          input_diff: DIFF,
          expected_output: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }],
        },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    const body = res.json();
    expect(body.result.citation_accuracy).toBe(1);

    const [run] = await db.select().from(t.evalRuns).where(eq(t.evalRuns.caseId, created.id));
    expect(run!.citationAccuracy).toBeNull();

    await app.close();
  });

  // ===========================================================================
  // Bulk run: per-case isolation (AC-13, AC-14, AC-47)
  // ===========================================================================

  it("bulk run: one case's failure doesn't abort the batch — 2 rows persisted, 1 error recorded, batch reaches done (AC-13, AC-14, AC-47)", async () => {
    class ThrowingLLMProvider extends MockLLMProvider {
      private n = 0;
      constructor(private failOnCall: number) {
        super('openai', { structured: reviewFixture([MATCHED_FINDING]) });
      }
      async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        this.n += 1;
        if (this.n === this.failOnCall) throw new Error('Simulated provider outage');
        return super.completeStructured(req);
      }
    }
    const llm = new ThrowingLLMProvider(2);
    const app = await appWithProvider(llm);
    const agent = await createAgent(app);

    const caseIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = (
        await app.inject({
          method: 'POST',
          url: '/eval-cases',
          payload: {
            owner_kind: 'agent',
            owner_id: agent.id,
            name: `bulk-case-${i}`,
            input_diff: DIFF,
            expected_output: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }],
          },
        })
      ).json();
      caseIds.push(created.id);
    }

    const started = await app.inject({
      method: 'POST',
      url: '/eval-cases/run-all',
      payload: { owner_kind: 'agent', owner_id: agent.id },
    });
    expect(started.statusCode).toBe(200);
    const { batch_id, total } = started.json();
    expect(total).toBe(3);

    const finalBatch = await pollBatch(app, batch_id);
    expect(finalBatch.status).toBe('done');
    expect(finalBatch.results).toHaveLength(2);
    expect(finalBatch.errors).toHaveLength(1);
    expect(finalBatch.errors[0]!.case_id).toBe(caseIds[1]);

    const { db } = pg.handle;
    const runs = await db.select().from(t.evalRuns).where(inArray(t.evalRuns.caseId, caseIds));
    expect(runs).toHaveLength(2);

    await app.close();
  });

  // ===========================================================================
  // Concurrent bulk run guard (AC-15)
  // ===========================================================================

  it('starting a second bulk run for the same owner while one is running returns 409 (AC-15)', async () => {
    class DelayedLLMProvider extends MockLLMProvider {
      constructor(private delayMs: number) {
        super('openai', { structured: reviewFixture([MATCHED_FINDING]) });
      }
      async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
        await new Promise((r) => setTimeout(r, this.delayMs));
        return super.completeStructured(req);
      }
    }
    const app = await appWithProvider(new DelayedLLMProvider(150));
    const agent = await createAgent(app);
    for (let i = 0; i < 2; i++) {
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: `slow-case-${i}`,
          input_diff: DIFF,
          expected_output: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }],
        },
      });
    }

    const first = await app.inject({
      method: 'POST',
      url: '/eval-cases/run-all',
      payload: { owner_kind: 'agent', owner_id: agent.id },
    });
    expect(first.statusCode).toBe(200);
    const { batch_id } = first.json();

    const second = await app.inject({
      method: 'POST',
      url: '/eval-cases/run-all',
      payload: { owner_kind: 'agent', owner_id: agent.id },
    });
    expect(second.statusCode).toBe(409);

    await pollBatch(app, batch_id);
    await app.close();
  });

  // ===========================================================================
  // Dashboard (AC-16, AC-17, AC-18, AC-19)
  // ===========================================================================

  it('dashboard for an owner with zero runs returns a well-formed zeroed payload (AC-19)', async () => {
    const app = await appWith(reviewFixture());
    const agent = await createAgent(app);
    await app.inject({
      method: 'POST',
      url: '/eval-cases',
      payload: { owner_kind: 'agent', owner_id: agent.id, name: 'never-run', input_diff: DIFF, expected_output: [] },
    });

    const res = await app.inject({ method: 'GET', url: `/eval-dashboard?owner_kind=agent&owner_id=${agent.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cases_total).toBe(1);
    expect(body.current).toEqual({
      recall: 0,
      precision: 0,
      citation_accuracy: 0,
      traces_passed: 0,
      traces_total: 0,
      cost_usd: null,
    });
    expect(body.trend).toEqual([]);
    expect(body.recent_runs).toEqual([]);
    expect(body.alert).toBeNull();

    await app.close();
  });

  it('dashboard workspace-wide: owner filters omitted, both null in response (AC-17)', async () => {
    const app = await appWith(reviewFixture());
    const res = await app.inject({ method: 'GET', url: '/eval-dashboard' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.owner_kind).toBeNull();
    expect(body.owner_id).toBeNull();

    await app.close();
  });

  it('a regression between two runs produces a non-null alert naming the worst metric (AC-18)', async () => {
    const app1 = await appWith(reviewFixture([MATCHED_FINDING]));
    const agent = await createAgent(app1);
    const created = (
      await app1.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'regression-case',
          input_diff: DIFF,
          expected_output: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }],
        },
      })
    ).json();
    const run1 = await app1.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    expect(run1.json().result.recall).toBe(1);
    await app1.close();

    const app2 = await appWith(reviewFixture([])); // regressed: nothing produced this time
    const run2 = await app2.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    expect(run2.json().result.recall).toBe(0);

    const dash = await app2.inject({ method: 'GET', url: `/eval-dashboard?owner_kind=agent&owner_id=${agent.id}` });
    const body = dash.json();
    expect(body.trend).toHaveLength(2);
    expect(body.alert).toContain('Recall');
    expect(body.delta.recall).toBeLessThanOrEqual(-0.05);

    await app2.close();
  });

  // ===========================================================================
  // Seeding from a finding (AC-27, AC-28, AC-30, Implementation Recommendations #4)
  // ===========================================================================

  it('seeding from an accepted finding produces a positive case; from a dismissed finding a negative case (AC-27, AC-28)', async () => {
    const app = await appWith(reviewFixture());
    const { db } = pg.handle;
    const agent = await createAgent(app);
    const { pr } = await setupRepoAndPr(db, workspaceId);

    const { finding: acceptedFinding } = await insertReviewAndFinding(db, {
      prId: pr.id,
      agentId: agent.id,
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      dismissed: false,
    });
    const positive = await app.inject({ method: 'POST', url: `/findings/${acceptedFinding.id}/eval-seed` });
    expect(positive.statusCode).toBe(200);
    const positiveBody = positive.json();
    expect(positiveBody.owner_kind).toBe('agent');
    expect(positiveBody.owner_id).toBe(agent.id);
    expect(positiveBody.name).toMatch(/^must-find-/);
    expect(positiveBody.expected_output).toHaveLength(1);
    expect(positiveBody.input_diff).toContain('diff --git a/src/config.ts b/src/config.ts');

    const { finding: dismissedFinding } = await insertReviewAndFinding(db, {
      prId: pr.id,
      agentId: agent.id,
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      dismissed: true,
    });
    const negative = await app.inject({ method: 'POST', url: `/findings/${dismissedFinding.id}/eval-seed` });
    expect(negative.statusCode).toBe(200);
    const negativeBody = negative.json();
    expect(negativeBody.name).toMatch(/^no-/);
    expect(negativeBody.expected_output).toEqual([]);

    await app.close();
  });

  it('seeding from a finding whose review has no resolvable agent returns owner_id: "" rather than throwing (AC-30)', async () => {
    const app = await appWith(reviewFixture());
    const { db } = pg.handle;
    const { pr } = await setupRepoAndPr(db, workspaceId);
    const { finding } = await insertReviewAndFinding(db, {
      prId: pr.id,
      agentId: null,
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      dismissed: false,
    });

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-seed` });
    expect(res.statusCode).toBe(200);
    expect(res.json().owner_id).toBe('');

    await app.close();
  });

  it('rejects seeding a finding whose sliced diff falls back to the whole raw diff (Implementation Recommendations #4)', async () => {
    const app = await appWith(reviewFixture());
    const { db } = pg.handle;
    const agent = await createAgent(app);
    const { pr } = await setupRepoAndPr(db, workspaceId);
    const { finding } = await insertReviewAndFinding(db, {
      prId: pr.id,
      agentId: agent.id,
      file: 'src/does-not-exist-in-diff.ts',
      startLine: 1,
      endLine: 1,
      dismissed: false,
    });

    const res = await app.inject({ method: 'POST', url: `/findings/${finding.id}/eval-seed` });
    expect(res.statusCode).toBe(422);

    await app.close();
  });

  // ===========================================================================
  // AC-29 — the seed route never touches the frozen finding-action enum
  // ===========================================================================

  it('never touches the frozen FindingActionKind enum (AC-29)', () => {
    expect(() =>
      execSync('git diff --exit-code -- src/vendor/shared/contracts/findings.ts', { cwd: process.cwd() }),
    ).not.toThrow();
  });

  // ===========================================================================
  // Orphaned case still listed, read-only (AC-39 server half)
  // ===========================================================================

  it('a case whose owner_id no longer resolves to any current agent/skill is still returned by GET (AC-39)', async () => {
    const app = await appWith(reviewFixture());
    const agent = await createAgent(app, { name: 'to-be-deleted' });
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: { owner_kind: 'agent', owner_id: agent.id, name: 'orphan-case', expected_output: [] },
      })
    ).json();

    const del = await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });
    expect(del.statusCode).toBe(200);

    const list = (
      await app.inject({ method: 'GET', url: `/eval-cases?owner_kind=agent&owner_id=${agent.id}` })
    ).json();
    expect(list.some((c: { id: string }) => c.id === created.id)).toBe(true);

    await app.close();
  });

  // ===========================================================================
  // Skill owner with no enabled linked agent (AC-42)
  // ===========================================================================

  it('a skill with no enabled linked agent returns the eval_owner_unavailable error from runCase (AC-42)', async () => {
    const app = await appWith(reviewFixture());
    const skill = (await app.inject({ method: 'POST', url: '/skills', payload: SKILL_BODY })).json();
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: { owner_kind: 'skill', owner_id: skill.id, name: 'no-agent-linked', input_diff: DIFF, expected_output: [] },
      })
    ).json();

    const res = await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('eval_owner_unavailable');

    await app.close();
  });

  // ===========================================================================
  // NFR — prompt-injection hardening: the diff is wrapped as untrusted content
  // ===========================================================================

  it('wraps the diff as untrusted content in the assembled prompt (Security — prompt injection guard)', async () => {
    const llm = new MockLLMProvider('openai', { structured: reviewFixture([MATCHED_FINDING]) });
    const app = await appWithProvider(llm);
    const agent = await createAgent(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'prompt-check',
          input_diff: DIFF,
          expected_output: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }],
        },
      })
    ).json();

    await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });

    const call = llm.calls.find(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName?: string }).schemaName === 'Review',
    );
    expect(call).toBeDefined();
    const messages = (call!.req as StructuredRequest<Review>).messages;
    const user = messages[1]!.content;
    expect(user).toContain('<untrusted source="diff">');

    await app.close();
  });

  // ===========================================================================
  // Label leakage regression — a seeded case's name (`must-find-<slug>` /
  // `no-<slug>`, buildSeedCaseName) must never reach the model. Before this
  // fix, `runCase` sent `task: Evaluate eval case "${caseRow.name}"`, which
  // told the model exactly whether to find something or not — making
  // recall/precision measure prompt-reading, not review quality.
  // ===========================================================================

  it('never leaks the case name, its must-find-/no- prefix, or expected_output into the LLM prompt — identical prompt for a positive vs. negative case (label leakage regression)', async () => {
    const llm = new MockLLMProvider('openai', { structured: reviewFixture([MATCHED_FINDING]) });
    const app = await appWithProvider(llm);
    const agent = await createAgent(app);

    const positiveExpected = [
      {
        file: 'src/config.ts',
        start_line: 11,
        end_line: 11,
        title: 'Server-Side Request Forgery',
        severity: 'CRITICAL',
        category: 'security',
      },
    ];
    const positive = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'must-find-server-side-request-forgery',
          input_diff: DIFF,
          expected_output: positiveExpected,
        },
      })
    ).json();
    const negative = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'no-server-side-request-forgery',
          input_diff: DIFF,
          expected_output: [],
        },
      })
    ).json();

    const lastReviewCall = () =>
      llm.calls
        .filter((c) => c.method === 'completeStructured' && (c.req as { schemaName?: string }).schemaName === 'Review')
        .at(-1)!.req as StructuredRequest<Review>;

    await app.inject({ method: 'POST', url: `/eval-cases/${positive.id}/run` });
    const positiveMessages = lastReviewCall().messages;

    await app.inject({ method: 'POST', url: `/eval-cases/${negative.id}/run` });
    const negativeMessages = lastReviewCall().messages;

    // Neither prompt may contain the case's own name, its must-find-/no-
    // prefix, the serialized expected_output, or the expected finding's
    // title (it names the vulnerability class but never appears in DIFF's
    // raw text — a real leak vector distinct from the case name itself).
    const forbidden = [
      'must-find-server-side-request-forgery',
      'no-server-side-request-forgery',
      JSON.stringify(positiveExpected),
      'Server-Side Request Forgery',
    ];
    for (const messages of [positiveMessages, negativeMessages]) {
      const fullText = messages.map((m) => m.content).join('\n');
      for (const needle of forbidden) {
        expect(fullText).not.toContain(needle);
      }
    }

    // Same agent config + same diff → byte-identical prompt content whether
    // the run came from the positive or the negative case. `sessionId`
    // (`eval:${caseRow.id}`) differs per case but never enters `messages`.
    expect(positiveMessages.map((m) => m.content)).toEqual(negativeMessages.map((m) => m.content));

    const userText = positiveMessages[1]!.content;
    expect(userText).toContain(EVAL_RUN_TASK);
    expect(userText).toContain('<untrusted source="diff">');

    await app.close();
  });

  it('sends the exact neutral EVAL_RUN_TASK line, not an interpolated case name (regression guard against reintroducing caseRow.name into task)', async () => {
    const llm = new MockLLMProvider('openai', { structured: reviewFixture([MATCHED_FINDING]) });
    const app = await appWithProvider(llm);
    const agent = await createAgent(app);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/eval-cases',
        payload: {
          owner_kind: 'agent',
          owner_id: agent.id,
          name: 'must-find-a-very-specific-leak-marker-xyz',
          input_diff: DIFF,
          expected_output: [{ file: 'src/config.ts', start_line: 11, end_line: 11 }],
        },
      })
    ).json();

    await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });

    const call = llm.calls.find(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName?: string }).schemaName === 'Review',
    );
    const userText = (call!.req as StructuredRequest<Review>).messages[1]!.content;

    // No linked skills / PR description / intent here, so `task` is always
    // the first joined section (`prompt.ts`'s `addUserSection` order) —
    // pins the task line to the exact constant, not merely "doesn't contain
    // the name", so a future `task: \`...${caseRow.name}\`` edit fails this
    // even if the interpolated name happens to dodge the substring checks
    // above.
    const taskLine = userText.split('\n\n')[0];
    expect(taskLine).toBe(EVAL_RUN_TASK);
    expect(userText).not.toContain('a-very-specific-leak-marker-xyz');

    await app.close();
  });
});
