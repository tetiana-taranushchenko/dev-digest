import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { ContextDocsService } from '../src/modules/context/service.js';
import { AgentsService } from '../src/modules/agents/service.js';

const d = (await dockerAvailable()) ? describe : describe.skip;

d('Project Context attachments (Postgres)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let userId: string;
  let clonePath: string;
  let context: ContextDocsService;
  let agents: AgentsService;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId, userId } = await seed(pg.handle.db));
    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-context-attach-'));
    const container = new Container(
      loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      pg.handle.db,
      { tokenizer: { count: (body) => body.length } },
    );
    context = new ContextDocsService(container);
    agents = new AgentsService(container);
  });

  afterAll(async () => {
    await rm(clonePath, { recursive: true, force: true });
    await pg?.stop();
  });

  it('stores ordered paths only and keeps a deleted attachment visible as unresolved', async () => {
    const unique = Date.now().toString(36);
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await writeFile(join(clonePath, 'docs/one.md'), 'ONE BODY');
    await writeFile(join(clonePath, 'docs/two.md'), 'TWO SECRET BODY');
    await pg.handle.db.insert(t.repos).values({
      workspaceId,
      owner: 'tests',
      name: `context-${unique}`,
      fullName: `tests/context-${unique}`,
      clonePath,
      createdBy: userId,
    });
    const agent = await agents.create(workspaceId, {
      name: `Context ${unique}`,
      provider: 'openai',
      model: 'test-model',
      system_prompt: 'Review safely.',
    }, userId);

    await context.setAgentPaths(agent.id, ['docs/two.md', 'docs/one.md']);

    const rows = await pg.handle.db
      .select()
      .from(t.agentContextDocs)
      .where(eq(t.agentContextDocs.agentId, agent.id));
    expect(rows.sort((a, b) => a.order - b.order)).toEqual([
      { agentId: agent.id, path: 'docs/two.md', order: 0 },
      { agentId: agent.id, path: 'docs/one.md', order: 1 },
    ]);
    expect(JSON.stringify(rows)).not.toContain('TWO SECRET BODY');
    expect(await context.listAgentPaths(agent.id)).toEqual(['docs/two.md', 'docs/one.md']);

    await unlink(join(clonePath, 'docs/two.md'));
    const attached = await agents.agentContextDocs(workspaceId, agent.id);
    expect(attached).toEqual([
      { path: 'docs/two.md', source: 'docs', tokens: null, resolved: false },
      { path: 'docs/one.md', source: 'docs', tokens: 8, resolved: true },
    ]);

    const versions = await pg.handle.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agent.id));
    expect(JSON.stringify(versions)).not.toContain('ONE BODY');
    expect(JSON.stringify(versions)).not.toContain('TWO SECRET BODY');
  });

  it('lists many documents as metadata only and names the no-clone condition', async () => {
    const unique = `${Date.now().toString(36)}-listing`;
    const listingClone = await mkdtemp(join(tmpdir(), 'devdigest-context-listing-'));
    await mkdir(join(listingClone, 'docs'), { recursive: true });
    const body = 'x'.repeat(8_000);
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        writeFile(join(listingClone, `docs/doc-${String(index).padStart(2, '0')}.md`), body),
      ),
    );
    const [repo] = await pg.handle.db.insert(t.repos).values({
      workspaceId,
      owner: 'tests',
      name: unique,
      fullName: `tests/${unique}`,
      clonePath: listingClone,
      createdBy: userId,
    }).returning();
    const [noClone] = await pg.handle.db.insert(t.repos).values({
      workspaceId,
      owner: 'tests',
      name: `${unique}-missing`,
      fullName: `tests/${unique}-missing`,
      createdBy: userId,
    }).returning();

    try {
      const listing = await context.listDocuments(workspaceId, repo!.id);
      expect(listing.files).toHaveLength(50);
      expect(listing.files.every((file) => file.content === null)).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(listing))).toBeLessThan(Buffer.byteLength(body) * 5);

      const unavailable = await context.listDocuments(workspaceId, noClone!.id);
      expect(unavailable.files).toEqual([]);
      expect(unavailable.index.unavailable_reason).toMatch(/not been cloned/i);
    } finally {
      await rm(listingClone, { recursive: true, force: true });
    }
  });
});
