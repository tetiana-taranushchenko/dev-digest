import { describe, expect, it, vi } from 'vitest';
import type { Container } from '../src/platform/container.js';
import type { PullRow, RepoRow } from '../src/db/rows.js';
import { gatherBriefSignals } from '../src/modules/brief/signals.js';
import { IntentService } from '../src/modules/intent/service.js';

/**
 * `gatherBriefSignals` (T5b, `docs/plans/pr-brief.md`) — the expensive,
 * `POST`-only signal gatherer. All facade dependencies (`reviewRepo`,
 * `repoIntel`, `contextDocs`, `github`) are stubbed on a minimal
 * `as unknown as Container` object, matching the existing convention
 * (`brief-state-key.test.ts`, `conventions-extractor.test.ts`).
 *
 * `config.repoIntelEnabled: false` is set on every fixture so `BlastService.
 * get` always takes its cheap degraded-stand-in path (`blast/service.ts`'s
 * `indexUsable` gate) — this suite is not exercising Blast Radius itself
 * (that's `blast/`'s own test suite), just that `gatherBriefSignals` wires
 * it in without ever leaking a hunk body or throwing on best-effort signals.
 */

function makePull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 42,
    title: 'Add feature',
    author: 'octocat',
    branch: 'feature',
    base: 'main',
    headSha: 'sha-head-1',
    lastReviewedSha: null,
    additions: 10,
    deletions: 2,
    filesCount: 2,
    status: 'needs_review',
    body: 'Fixes #7',
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as PullRow;
}

function makeRepo(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    id: 'repo-1',
    workspaceId: 'ws-1',
    owner: 'octocat',
    name: 'hello-world',
    fullName: 'octocat/hello-world',
    defaultBranch: 'main',
    clonePath: '/tmp/clone',
    lastPolledAt: null,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as RepoRow;
}

interface PrFileFixture {
  path: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

/** A COMPLETE intent row (`isCompleteRow` in `intent/service.ts` requires
 *  `provider`/`model`/`confidence_reason` all non-null) — the shape
 *  `IntentService.get()` needs to resolve successfully instead of throwing
 *  `NotFoundError`. */
function makeCompleteIntentRow(overrides: Record<string, unknown> = {}) {
  return {
    pr_id: 'pr-1',
    intent: 'Add a new feature',
    in_scope: ['src/a.ts'],
    out_of_scope: [],
    confidence: 'high',
    confidence_reason: 'All signals present',
    sources: [],
    provider: 'openai',
    model: 'gpt-test',
    generated_at: '2026-01-01T00:00:00.000Z',
    headSha: 'sha-head-1',
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.01,
    durationMs: 100,
    ...overrides,
  };
}

interface Fixture {
  pull: PullRow;
  repo: RepoRow;
  intentRow: Record<string, unknown> | undefined;
  prFiles: PrFileFixture[];
  commits: { message: string; committedAt: Date | null }[];
  docs: { path: string; body: string }[];
  githubGetIssue: (repo: unknown, n: number) => Promise<{ number: number; title: string; body: string | null }>;
}

function baseFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    pull: makePull(),
    repo: makeRepo(),
    intentRow: undefined,
    prFiles: [
      { path: 'src/a.ts', additions: 5, deletions: 1, patch: '@@ -1,1 +1,5 @@\n+ secret internal diff body' },
      { path: 'src/b.ts', additions: 2, deletions: 0, patch: '@@ -0,0 +1,2 @@\n+ another secret hunk' },
    ],
    commits: [{ message: 'Add feature\n\nlonger body', committedAt: new Date('2026-01-01T00:00:00.000Z') }],
    docs: [],
    githubGetIssue: async (_repo, n) => ({ number: n, title: 'Linked issue', body: 'Issue body' }),
    ...overrides,
  };
}

function makeContainer(fx: Fixture): Container {
  return {
    config: { repoIntelEnabled: false },
    reviewRepo: {
      getPull: async () => fx.pull,
      getRepo: async () => fx.repo,
      getIntent: async () => fx.intentRow,
      getPrFiles: async () => fx.prFiles,
      getPrCommits: async () => fx.commits,
      getPriorPrsTouchingFiles: async () => [],
    },
    repoIntel: {
      getIndexState: async () => ({
        status: 'missing',
        filesIndexed: 0,
        filesSkipped: 0,
        durationMs: 0,
        repoId: fx.repo.id,
        lastIndexedSha: '',
        indexerVersion: 1,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        degradedReason: 'no_data',
      }),
    },
    contextDocs: {
      readBodies: async () => ({
        resolved: fx.docs.map((d) => ({ path: d.path, body: d.body })),
        skipped: [],
      }),
    },
    github: async () => ({ getIssue: fx.githubGetIssue }),
  } as unknown as Container;
}

async function run(fx: Fixture, resolvedPaths: string[] = []) {
  return gatherBriefSignals(makeContainer(fx), 'ws-1', fx.pull, fx.repo, 'agent-1', resolvedPaths);
}

describe('gatherBriefSignals', () => {
  it('AC-3: a missing intent row yields intentAvailable:false, omits the intent section, and never calls classify/derive', async () => {
    const classifySpy = vi.spyOn(IntentService.prototype, 'classify');
    const fx = baseFixture({ intentRow: undefined });

    const result = await run(fx);

    expect(result.intentAvailable).toBe(false);
    expect(result.sections.some((s) => s.kind === 'intent')).toBe(false);
    expect(classifySpy).not.toHaveBeenCalled();
    classifySpy.mockRestore();
  });

  it('AC-6: no linked issue reference and a failing issue fetch both proceed without an issue section', async () => {
    const noReference = await run(baseFixture({ pull: makePull({ body: 'No issue reference here' }) }));
    expect(noReference.sections.some((s) => s.kind === 'issue')).toBe(false);

    const fetchFails = await run(
      baseFixture({
        pull: makePull({ body: 'Fixes #7' }),
        githubGetIssue: async () => {
          throw new Error('GitHub API unavailable');
        },
      }),
    );
    expect(fetchFails.sections.some((s) => s.kind === 'issue')).toBe(false);
  });

  it('AC-5: a patch present on getPrFiles rows never appears in any returned section', async () => {
    const fx = baseFixture();
    const result = await run(fx);

    const diffStats = result.sections.find((s) => s.kind === 'diff_stats');
    expect(diffStats).toBeDefined();
    if (diffStats?.kind === 'diff_stats') {
      for (const file of diffStats.files) {
        expect(Object.keys(file).sort()).toEqual(['additions', 'deletions', 'path']);
      }
    }

    const serialized = JSON.stringify(result.sections);
    for (const file of fx.prFiles) {
      expect(serialized).not.toContain(file.patch);
    }
  });

  it('returns sections in D9 priority order and resolves a linked issue when present', async () => {
    const fx = baseFixture({ intentRow: makeCompleteIntentRow() });

    const result = await run(fx);

    expect(result.sections.map((s) => s.kind)).toEqual([
      'pr',
      'intent',
      'blast',
      'diff_stats',
      'issue',
      'commits',
    ]);
    expect(result.sections[0]).toMatchObject({ kind: 'pr', droppable: false });
    expect(result.sections.slice(1).every((s) => s.droppable)).toBe(true);
  });

  it('reads document bodies via readBodies (never listDocuments) and produces one docs section per document', async () => {
    const fx = baseFixture({
      docs: [
        { path: 'specs/a.md', body: 'Spec A body' },
        { path: 'specs/b.md', body: 'Spec B body' },
      ],
    });

    const result = await run(fx, ['specs/a.md', 'specs/b.md']);

    const docsSections = result.sections.filter((s) => s.kind === 'docs');
    expect(docsSections).toHaveLength(2);
    expect(docsSections.every((s) => s.droppable)).toBe(true);
    expect(result.docsContentFingerprint.length).toBeGreaterThan(0);
    expect(result.accepted.focusFiles.has('src/a.ts')).toBe(true);
    expect(result.accepted.riskFiles.has('src/a.ts')).toBe(true);
  });
});
