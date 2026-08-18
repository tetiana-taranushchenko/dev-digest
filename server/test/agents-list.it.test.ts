import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-list] Docker not available — skipping integration tests.');
}

/**
 * GET /agents — `skill_count` per agent (agents/service.ts:list,
 * agents/repository.ts:countSkillsByAgent). Computed in one grouped query
 * instead of the client making one `/agents/:id/skills` request per agent.
 */
d('GET /agents', () => {
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

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  it('returns skill_count 0 for an agent with no linked skills, and the real count for one that has some', async () => {
    const app = await makeApp();

    const bare = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'Bare Agent', provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review.' },
    });
    expect(bare.statusCode).toBe(201);
    const bareId = bare.json().id as string;

    const linked = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name: 'Linked Agent', provider: 'openai', model: 'gpt-4o-mini', system_prompt: 'Review.' },
    });
    expect(linked.statusCode).toBe(201);
    const linkedId = linked.json().id as string;

    const skillRows = await pg.handle.db
      .insert(t.skills)
      .values([
        { workspaceId, name: 'Skill A', description: 'A', type: 'convention', source: 'manual', body: 'Body A' },
        { workspaceId, name: 'Skill B', description: 'B', type: 'convention', source: 'manual', body: 'Body B' },
      ])
      .returning();

    await pg.handle.db.insert(t.agentSkills).values([
      { agentId: linkedId, skillId: skillRows[0]!.id, order: 0 },
      { agentId: linkedId, skillId: skillRows[1]!.id, order: 1 },
    ]);

    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    const agents = res.json() as Array<{ id: string; skill_count?: number }>;

    expect(agents.find((a) => a.id === bareId)?.skill_count).toBe(0);
    expect(agents.find((a) => a.id === linkedId)?.skill_count).toBe(2);

    await app.close();
  });
});
