import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Container } from '../src/platform/container.js';
import {
  collectConventionSamples,
  safeRepoPath,
  verifyConventionCandidates,
  type ConventionSample,
} from '../src/modules/conventions/extractor.js';

const sample: ConventionSample = {
  path: 'src/api/users.ts',
  content: 'export async function listUsers() {\n  return service.list();\n}\n',
  lines: [
    'export async function listUsers() {',
    '  return service.list();',
    '}',
    '',
  ],
};

describe('convention evidence grounding', () => {
  it('selects root config files plus deterministic repo-intel samples without a model', async () => {
    const clonePath = await mkdtemp(join(tmpdir(), 'convention-samples-'));
    try {
      await mkdir(join(clonePath, 'src'));
      await writeFile(join(clonePath, 'eslint.config.js'), 'export default {};\n');
      await writeFile(join(clonePath, 'tsconfig.json'), '{}\n');
      await writeFile(join(clonePath, 'src/users.ts'), 'export const users = [];\n');
      const container = {
        repoIntel: {
          getConventionSamples: async () => ['src/users.ts', '../outside.ts'],
        },
      } as unknown as Container;

      const samples = await collectConventionSamples(container, 'repo-1', clonePath);
      expect(samples.map((item) => item.path)).toEqual([
        'eslint.config.js',
        'tsconfig.json',
        'src/users.ts',
      ]);
    } finally {
      await rm(clonePath, { recursive: true, force: true });
    }
  });

  it('accepts an exact sampled path and a real non-empty line', () => {
    const result = verifyConventionCandidates(
      [sample],
      {
        candidates: [
          {
            category: 'async',
            rule: 'Use async functions for service-backed route handlers.',
            evidence: { path: sample.path, line: 1 },
            confidence: 0.91,
          },
        ],
      },
      'abc123',
    );

    expect(result).toEqual([
      expect.objectContaining({
        evidencePath: sample.path,
        evidenceLine: 1,
        evidenceRef: 'abc123',
        evidenceSnippet: expect.stringContaining('1 | export async function'),
      }),
    ]);
  });

  it('drops missing paths, traversal, invalid lines, blank lines, and low confidence', () => {
    const candidates = [
      { path: 'src/missing.ts', line: 1, confidence: 0.9 },
      { path: '../secret.ts', line: 1, confidence: 0.9 },
      { path: sample.path, line: 99, confidence: 0.9 },
      { path: sample.path, line: 4, confidence: 0.9 },
      { path: sample.path, line: 1, confidence: 0.59 },
    ].map(({ path, line, confidence }) => ({
      category: 'other' as const,
      rule: 'Use a sufficiently specific repository convention.',
      evidence: { path, line },
      confidence,
    }));

    expect(verifyConventionCandidates([sample], { candidates }, 'abc123')).toEqual([]);
  });

  it('deduplicates identical grounded candidates and sorts by confidence', () => {
    const candidate = {
      category: 'async' as const,
      rule: 'Use async functions for service-backed route handlers.',
      evidence: { path: sample.path, line: 1 },
    };
    const result = verifyConventionCandidates(
      [sample],
      {
        candidates: [
          { ...candidate, confidence: 0.7 },
          { ...candidate, confidence: 0.95 },
          {
            category: 'errors',
            rule: 'Return typed errors from public service boundaries.',
            evidence: { path: sample.path, line: 2 },
            confidence: 0.8,
          },
        ],
      },
      'abc123',
    );

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.confidence)).toEqual([0.95, 0.8]);
  });

  it('rejects absolute, backslash, empty-segment, and traversal paths', () => {
    expect(safeRepoPath('/etc/passwd')).toBeNull();
    expect(safeRepoPath('src\\users.ts')).toBeNull();
    expect(safeRepoPath('src//users.ts')).toBeNull();
    expect(safeRepoPath('src/../users.ts')).toBeNull();
    expect(safeRepoPath('src/users.ts')).toBe('src/users.ts');
  });
});
