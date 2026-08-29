import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dockerAvailable, startPg, type PgFixture } from './helpers/pg.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { loadConfig } from '../src/platform/config.js';
import { Container } from '../src/platform/container.js';
import { ContextDocsService } from '../src/modules/context/service.js';
import { assemblePrompt } from '@devdigest/reviewer-core';

const d = (await dockerAvailable()) ? describe : describe.skip;

d('Project Context injection inputs (Postgres)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let clonePath: string;
  let context: ContextDocsService;

  beforeAll(async () => {
    pg = await startPg();
    ({ workspaceId } = await seed(pg.handle.db));
    clonePath = await mkdtemp(join(tmpdir(), 'devdigest-context-inject-'));
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await Promise.all([
      writeFile(join(clonePath, 'docs/direct.md'), 'DIRECT'),
      writeFile(join(clonePath, 'docs/shared.md'), 'SHARED'),
      writeFile(join(clonePath, 'docs/enabled.md'), 'ENABLED'),
      writeFile(join(clonePath, 'docs/disabled.md'), 'DISABLED'),
      writeFile(join(clonePath, 'docs/deleted.md'), 'DELETE ME'),
    ]);
    const container = new Container(
      loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      pg.handle.db,
      { tokenizer: { count: (body) => body.length } },
    );
    context = new ContextDocsService(container);
  });

  afterAll(async () => {
    await rm(clonePath, { recursive: true, force: true });
    await pg?.stop();
  });

  it('orders direct docs before enabled skills, dedupes first occurrence, and skips disabled skills', async () => {
    const unique = Date.now().toString(36);
    const [agent] = await pg.handle.db.insert(t.agents).values({
      workspaceId,
      name: `Injection ${unique}`,
      provider: 'openai',
      model: 'test',
      systemPrompt: 'review',
    }).returning();
    const [enabled, disabled] = await pg.handle.db.insert(t.skills).values([
      { workspaceId, name: `Enabled ${unique}`, description: '', type: 'custom', source: 'manual', body: 'enabled', enabled: true },
      { workspaceId, name: `Disabled ${unique}`, description: '', type: 'custom', source: 'manual', body: 'disabled', enabled: false },
    ]).returning();
    await pg.handle.db.insert(t.agentSkills).values([
      { agentId: agent!.id, skillId: enabled!.id, order: 0 },
      { agentId: agent!.id, skillId: disabled!.id, order: 1 },
    ]);
    await context.setAgentPaths(agent!.id, ['docs/direct.md', 'docs/shared.md', 'docs/deleted.md']);
    await context.setSkillPaths(enabled!.id, ['docs/shared.md', 'docs/enabled.md']);
    await context.setSkillPaths(disabled!.id, ['docs/disabled.md']);

    const paths = await context.resolveForAgent(agent!.id);
    expect(paths).toEqual(['docs/direct.md', 'docs/shared.md', 'docs/deleted.md', 'docs/enabled.md']);
    expect(paths).not.toContain('docs/disabled.md');

    await unlink(join(clonePath, 'docs/deleted.md'));
    const bodies = await context.readBodies(clonePath, paths);
    expect(bodies.resolved.map((doc) => doc.path)).toEqual([
      'docs/direct.md',
      'docs/shared.md',
      'docs/enabled.md',
    ]);
    expect(bodies.skipped).toEqual([{ path: 'docs/deleted.md', reason: 'not_found' }]);

    const prompt = assemblePrompt({
      system: 'Review safely.',
      task: 'Review this diff.',
      diff: 'diff --git a/a.ts b/a.ts',
      specs: bodies.resolved.map((doc) => doc.body),
    });
    expect(prompt.summary.sections.filter((section) => section.section === 'specs')).toHaveLength(1);
    expect(prompt.assembly.specs).toContain('<untrusted source="spec-0">');
    expect(prompt.assembly.specs).toContain('<untrusted source="spec-1">');
    expect(prompt.assembly.specs).toContain('<untrusted source="spec-2">');
    expect(prompt.assembly.user).toContain('## Project context');
    expect(prompt.assembly.user.indexOf('DIRECT')).toBeLessThan(prompt.assembly.user.indexOf('SHARED'));
    expect(prompt.assembly.user.indexOf('SHARED')).toBeLessThan(prompt.assembly.user.indexOf('ENABLED'));
    expect(prompt.assembly.user).not.toContain('DISABLED');
  });

  it('keeps the zero-document prompt byte-clean and records no specs section', () => {
    const prompt = assemblePrompt({
      system: 'Review safely.',
      task: 'Review this diff.',
      diff: 'diff --git a/a.ts b/a.ts',
    });

    expect(prompt.assembly.specs).toBeNull();
    expect(prompt.summary.sections.some((section) => section.section === 'specs')).toBe(false);
    expect(prompt.assembly.user).not.toContain('## Project context');
  });
});
