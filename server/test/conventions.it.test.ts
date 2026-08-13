import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { LLMProvider } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

d('conventions module', () => {
  let pg: PgFixture;
  let clonePath: string;
  let repoId: string;
  const llm = new MockLLMProvider('openai', {
    structuredBySchema: {
      ConventionExtraction: {
        candidates: [
          {
            category: 'async',
            rule: 'Use async functions for public route handlers.',
            evidence: { path: 'src/users.ts', line: 1 },
            confidence: 0.92,
          },
          {
            category: 'errors',
            rule: 'Throw typed domain errors at service boundaries.',
            evidence: { path: 'src/errors.ts', line: 1 },
            confidence: 0.84,
          },
          {
            category: 'other',
            rule: 'This hallucinated file must be rejected mechanically.',
            evidence: { path: 'src/missing.ts', line: 1 },
            confidence: 0.99,
          },
        ],
      },
    },
  });

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-conventions-'));
    await mkdir(join(clonePath, 'src'));
    await writeFile(join(clonePath, 'src/users.ts'), 'export async function users() {}\n');
    await writeFile(join(clonePath, 'src/errors.ts'), 'throw new DomainError();\n');
    await writeFile(join(clonePath, 'eslint.config.js'), 'export default { semi: true };\n');
    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(
        and(
          eq(t.repos.workspaceId, seeded.workspaceId),
          eq(t.repos.fullName, 'acme/payments-api'),
        ),
      );
    repoId = repo!.id;
    await pg.handle.db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));
  });

  afterAll(async () => {
    await pg?.stop();
    if (clonePath) await rm(clonePath, { recursive: true, force: true });
  });

  async function makeApp(provider: LLMProvider = llm) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const repoIntel = {
      getConventionSamples: async () => ['src/users.ts', 'src/errors.ts'],
    } as unknown as RepoIntel;
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ head: 'deadbeef' }),
        github: new MockGitHubClient(),
        llm: { openai: provider },
        repoIntel,
      },
    });
  }

  it('extracts only grounded candidates and persists approve/reject/edit decisions', async () => {
    const app = await makeApp();
    const extracted = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(extracted.statusCode).toBe(200);
    expect(extracted.json()).toHaveLength(2);
    expect(extracted.json()[0]).toMatchObject({
      evidence_path: 'src/users.ts',
      evidence_line: 1,
      evidence_ref: 'deadbeef',
      status: 'pending',
    });

    const [first, second] = extracted.json() as { id: string }[];
    const approved = await app.inject({
      method: 'PATCH',
      url: `/repos/${repoId}/conventions/${first!.id}`,
      payload: { status: 'approved', rule: 'Always use async route handlers.' },
    });
    expect(approved.json()).toMatchObject({
      status: 'approved',
      accepted: true,
      rule: 'Always use async route handlers.',
    });
    const rejected = await app.inject({
      method: 'PATCH',
      url: `/repos/${repoId}/conventions/${second!.id}`,
      payload: { status: 'rejected' },
    });
    expect(rejected.json()).toMatchObject({ status: 'rejected', accepted: false });

    const list = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(list.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: first!.id, status: 'approved' }),
        expect.objectContaining({ id: second!.id, status: 'rejected' }),
      ]),
    );
    await app.close();
  });

  it('keeps the existing candidates when a re-scan fails before replacement', async () => {
    const beforeApp = await makeApp();
    const before = await beforeApp.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    await beforeApp.close();

    const failingLlm = {
      id: 'openai',
      completeStructured: async () => {
        throw new Error('simulated model failure');
      },
    } as unknown as LLMProvider;
    const app = await makeApp(failingLlm);
    const failed = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(failed.statusCode).toBe(500);
    const after = await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` });
    expect(after.json()).toEqual(before.json());
    await app.close();
  });

  it('builds and creates an editable skill from approved candidates only', async () => {
    const app = await makeApp();
    const draft = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/conventions/skill-draft`,
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      name: 'repo-conventions',
      candidate_count: 1,
      evidence_files: ['src/users.ts'],
    });
    expect(draft.json().body).toContain('Always use async route handlers.');
    expect(draft.json().body).not.toContain('Throw typed domain errors');

    const created = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        name: 'repo-conventions',
        description: 'Edited before save.',
        body: '# Edited skill\nOnly the approved rule remains.',
        enabled: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'repo-conventions',
      type: 'convention',
      source: 'extracted',
      body: '# Edited skill\nOnly the approved rule remains.',
      evidence_files: ['src/users.ts'],
    });
    await app.close();
  });

  it('a successful re-scan replaces candidates and resets decisions to pending', async () => {
    const app = await makeApp();
    const rescanned = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(rescanned.statusCode).toBe(200);
    expect(rescanned.json()).toHaveLength(2);
    expect(rescanned.json().every((candidate: { status: string }) => candidate.status === 'pending')).toBe(
      true,
    );
    await app.close();
  });
});
