import { describe, expect, it } from 'vitest';
import type { Container } from '../src/platform/container.js';
import {
  computeBriefStateKey,
  type BriefStatePull,
  type BriefStateRepo,
} from '../src/modules/brief/state-key.js';

/**
 * `computeBriefStateKey` (T5a, `docs/plans/pr-brief.md`) — one key, built
 * from 7 independent components. This suite mutates each component alone
 * and asserts the key changes, mirroring the plan's acceptance criterion.
 * All facade dependencies (`reviewRepo`, `contextDocs`, `repoIntel`) are
 * stubbed on a minimal `as unknown as Container` object, matching the
 * existing convention (`conventions-extractor.test.ts`).
 */

interface Fixture {
  headSha: string;
  agentId: string;
  title: string;
  body: string | null;
  intentRow: { headSha: string | null; generated_at: string } | undefined;
  resolvedPaths: string[];
  statResolved: { path: string; mtimeMs: number; size: number }[];
  lastIndexedSha: string;
  updatedAt: Date;
}

function baseFixture(): Fixture {
  return {
    headSha: 'sha-head-1',
    agentId: 'agent-1',
    title: 'Add feature',
    body: 'Some PR body',
    intentRow: { headSha: 'sha-head-1', generated_at: '2026-01-01T00:00:00.000Z' },
    resolvedPaths: ['docs/a.md', 'docs/b.md'],
    statResolved: [
      { path: 'docs/a.md', mtimeMs: 100, size: 10 },
      { path: 'docs/b.md', mtimeMs: 200, size: 20 },
    ],
    lastIndexedSha: 'sha-index-1',
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

function makeContainer(fx: Fixture): Container {
  return {
    reviewRepo: {
      getIntent: async () => fx.intentRow,
    },
    contextDocs: {
      resolveForAgent: async () => fx.resolvedPaths,
      statBodies: async () => ({ resolved: fx.statResolved, skipped: [] }),
    },
    repoIntel: {
      getIndexState: async () => ({
        status: 'full',
        filesIndexed: 1,
        filesSkipped: 0,
        durationMs: 1,
        repoId: 'repo-1',
        lastIndexedSha: fx.lastIndexedSha,
        indexerVersion: 1,
        updatedAt: fx.updatedAt,
      }),
    },
  } as unknown as Container;
}

function pullFrom(fx: Fixture): BriefStatePull {
  return { id: 'pr-1', headSha: fx.headSha, title: fx.title, body: fx.body };
}

const repo: BriefStateRepo = { id: 'repo-1', clonePath: '/tmp/clone' };

async function keyFor(fx: Fixture): Promise<string> {
  const result = await computeBriefStateKey({
    container: makeContainer(fx),
    pull: pullFrom(fx),
    repo,
    agentId: fx.agentId,
  });
  return result.stateKey;
}

describe('computeBriefStateKey', () => {
  it('produces a byte-identical key across two calls with an unchanged input set', async () => {
    const fx = baseFixture();
    const [a, b] = await Promise.all([keyFor(fx), keyFor(fx)]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when head_sha changes (component 1)', async () => {
    const base = await keyFor(baseFixture());
    const mutated = await keyFor({ ...baseFixture(), headSha: 'sha-head-2' });
    expect(mutated).not.toBe(base);
  });

  it('changes when agent_id changes (component 2)', async () => {
    const base = await keyFor(baseFixture());
    const mutated = await keyFor({ ...baseFixture(), agentId: 'agent-2' });
    expect(mutated).not.toBe(base);
  });

  it('changes when the PR title or body changes (component 3)', async () => {
    const base = await keyFor(baseFixture());
    const mutatedTitle = await keyFor({ ...baseFixture(), title: 'A different title' });
    const mutatedBody = await keyFor({ ...baseFixture(), body: 'A different body' });
    expect(mutatedTitle).not.toBe(base);
    expect(mutatedBody).not.toBe(base);
  });

  it('changes when the intent marker changes (component 4)', async () => {
    const base = await keyFor(baseFixture());
    const noIntentYet = await keyFor({ ...baseFixture(), intentRow: undefined });
    const reDerived = await keyFor({
      ...baseFixture(),
      intentRow: { headSha: 'sha-head-1', generated_at: '2026-01-03T00:00:00.000Z' },
    });
    expect(noIntentYet).not.toBe(base);
    expect(reDerived).not.toBe(base);
  });

  it('changes when the attached-document set changes (component 5)', async () => {
    const base = await keyFor(baseFixture());
    const detached = await keyFor({
      ...baseFixture(),
      resolvedPaths: ['docs/a.md'],
      statResolved: [{ path: 'docs/a.md', mtimeMs: 100, size: 10 }],
    });
    expect(detached).not.toBe(base);
  });

  it('changes when the same attached-path set is reordered (component 5, order matters)', async () => {
    const base = await keyFor(baseFixture());
    const reordered = await keyFor({
      ...baseFixture(),
      resolvedPaths: ['docs/b.md', 'docs/a.md'],
    });
    expect(reordered).not.toBe(base);
  });

  it('changes when a resolved document mtime/size changes (component 6, docs metadata fingerprint)', async () => {
    const base = await keyFor(baseFixture());
    const mutated = await keyFor({
      ...baseFixture(),
      statResolved: [
        { path: 'docs/a.md', mtimeMs: 999, size: 10 },
        { path: 'docs/b.md', mtimeMs: 200, size: 20 },
      ],
    });
    expect(mutated).not.toBe(base);
  });

  it('changes when the repo index state changes (component 7)', async () => {
    const base = await keyFor(baseFixture());
    const differentSha = await keyFor({ ...baseFixture(), lastIndexedSha: 'sha-index-2' });
    const differentUpdatedAt = await keyFor({
      ...baseFixture(),
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(differentSha).not.toBe(base);
    expect(differentUpdatedAt).not.toBe(base);
  });
});
