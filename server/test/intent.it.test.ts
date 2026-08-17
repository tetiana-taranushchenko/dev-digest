import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[intent] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * Structured-output fixture for the `Intent` schema
 * (`reviewer-core/src/intent/schema.ts`'s `IntentClassification`) — no
 * `confidence` field, since REQ-4 derives that deterministically in code,
 * never from the model.
 */
const INTENT_FIXTURE = {
  intent: 'Add token-bucket rate limiting to public API endpoints.',
  in_scope: ['Rate limiter middleware', 'Public endpoint wiring'],
  out_of_scope: ['Authentication changes'],
};

d('intent module (Testcontainers pg)', () => {
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
      .values({ workspaceId, owner: 'acme', name: 'intent-target', fullName: 'acme/intent-target' })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 501,
        title: 'Add token-bucket rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rate-limit',
        base: 'main',
        headSha: 'deadbeef01',
        additions: 42,
        deletions: 3,
        filesCount: 2,
        status: 'needs_review',
        // No body / linked plan / linked issue on purpose — this PR is
        // classified from indirect signals only (title, commits, paths,
        // diff), which `deriveConfidence` maps deterministically to `low`.
      })
      .returning();
    prId = pr!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    // `review_intent`'s registry default is `openrouter` /
    // `deepseek/deepseek-v4-flash` (`src/vendor/shared/contracts/platform.ts`),
    // so the mock must be keyed under `openrouter` for
    // `container.llm('openrouter')` to pick it up instead of a real provider.
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { Intent: INTENT_FIXTURE },
    });
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        llm: { openrouter: llm },
      },
    });
  }

  it('POST derives and persists a PrIntentRecord, then GET round-trips the same data', async () => {
    const app = await makeApp();

    // Before any classification, GET 404s (service.ts's `isCompleteRow` gate).
    const before = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(before.statusCode).toBe(404);

    const posted = await app.inject({ method: 'POST', url: `/pulls/${prId}/intent` });
    expect(posted.statusCode).toBe(200);
    const record = posted.json();
    expect(record).toMatchObject({
      pr_id: prId,
      intent: INTENT_FIXTURE.intent,
      in_scope: INTENT_FIXTURE.in_scope,
      out_of_scope: INTENT_FIXTURE.out_of_scope,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
      // No linked plan/issue and no PR description ⇒ `low` per the
      // documented confidence-tier table (plan §1).
      confidence: 'low',
    });
    expect(typeof record.confidence_reason).toBe('string');
    expect(record.confidence_reason.length).toBeGreaterThan(0);
    expect(Array.isArray(record.sources)).toBe(true);
    expect(record.sources.length).toBeGreaterThan(0);
    // Every source entry names which signal it is and whether it was fetched.
    for (const source of record.sources) {
      expect(source).toHaveProperty('signal');
      expect(source).toHaveProperty('fetched');
    }
    // The diff and title signals are always available for this PR, so they
    // must have been fetched.
    expect(
      record.sources.some((s: { signal: string; fetched: boolean }) => s.signal === 'diff' && s.fetched),
    ).toBe(true);
    expect(
      record.sources.some((s: { signal: string; fetched: boolean }) => s.signal === 'pr_title' && s.fetched),
    ).toBe(true);

    // GET now round-trips the exact persisted record.
    const after = await app.inject({ method: 'GET', url: `/pulls/${prId}/intent` });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toEqual(record);

    await app.close();
  });
});
