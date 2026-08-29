import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextDocsService } from '../src/modules/context/service.js';
import { resolveManifestContext } from '../src/modules/context/manifest.js';
import { MAX_FILE_SIZE } from '../src/modules/context/constants.js';
import type { Container } from '../src/platform/container.js';

const tempDirs: string[] = [];

async function tempClone(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'devdigest-context-'));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fakeDb(resultSets: unknown[][]) {
  let index = 0;
  return {
    select() {
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: async () => resultSets[index++] ?? [],
      };
      return query;
    },
  };
}

function serviceFor(clonePath: string, count: (body: string) => number) {
  const db = fakeDb([
    [{ id: 'repo-1', clonePath }],
    [],
    [],
  ]);
  return new ContextDocsService({ db, tokenizer: { count } } as unknown as Container);
}

describe('Project Context discovery', () => {
  it('discovers only safe, in-budget markdown and classifies every supported root', async () => {
    const root = await tempClone();
    await Promise.all([
      mkdir(join(root, 'docs'), { recursive: true }),
      mkdir(join(root, 'specs'), { recursive: true }),
      mkdir(join(root, 'insights'), { recursive: true }),
      mkdir(join(root, '.devdigest/specs'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, 'docs/guide.md'), 'docs body'),
      writeFile(join(root, 'specs/feature.md'), 'spec body'),
      writeFile(join(root, 'insights/run.md'), 'insight body'),
      writeFile(join(root, '.devdigest/specs/private.md'), 'private spec'),
      writeFile(join(root, 'docs/too-large.md'), Buffer.alloc(MAX_FILE_SIZE + 1, 97)),
    ]);

    const tokenCount = (body: string) => body.length * 3;
    const listing = await serviceFor(root, tokenCount).listDocuments('w1', 'repo-1');

    expect(listing.files.map(({ path, source }) => [path, source])).toEqual([
      ['.devdigest/specs/private.md', 'spec'],
      ['docs/guide.md', 'docs'],
      ['insights/run.md', 'insights'],
      ['specs/feature.md', 'spec'],
    ]);
    expect(listing.files.find((file) => file.path === 'docs/guide.md')?.tokens).toBe(tokenCount('docs body'));
    expect(listing.files.some((file) => file.path.endsWith('too-large.md'))).toBe(false);
    expect(listing.files.every((file) => file.content === null)).toBe(true);
  });

  it('does not follow a symlinked specs directory outside the clone', async () => {
    const root = await tempClone();
    const outside = await tempClone();
    await mkdir(join(root, '.devdigest'), { recursive: true });
    await mkdir(join(outside, 'specs'), { recursive: true });
    await writeFile(join(outside, 'specs/x.md'), 'must stay outside');
    await symlink(join(outside, 'specs'), join(root, '.devdigest/specs'));

    const listing = await serviceFor(root, (body) => body.length).listDocuments('w1', 'repo-1');
    expect(listing.files).toEqual([]);
  });

  it('skips unsafe body paths without throwing', async () => {
    const root = await tempClone();
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs/ok.md'), 'ok');
    const service = serviceFor(root, (body) => body.length);

    const result = await service.readBodies(root, [
      'docs/ok.md',
      '../../../../etc/passwd',
      '/etc/passwd',
      'docs\\ok.md',
    ]);

    expect(result.resolved).toEqual([{ path: 'docs/ok.md', body: 'ok' }]);
    expect(result.skipped).toEqual([
      { path: '../../../../etc/passwd', reason: 'unsafe_path' },
      { path: '/etc/passwd', reason: 'unsafe_path' },
      { path: 'docs\\ok.md', reason: 'unsafe_path' },
    ]);
  });

  it('resolves manifest context in order and reports out-of-root symlinks', async () => {
    const root = await tempClone();
    const outside = await tempClone();
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs/ok.md'), 'manifest body');
    await writeFile(join(outside, 'secret.md'), 'secret');
    await symlink(join(outside, 'secret.md'), join(root, 'docs/escape.md'));

    const result = await resolveManifestContext(
      { context: ['docs/ok.md', 'docs/escape.md', '../secret.md'] },
      root,
    );

    expect(result.resolved).toEqual([{ path: 'docs/ok.md', body: 'manifest body' }]);
    expect(result.skipped).toEqual([
      { path: 'docs/escape.md', reason: 'outside_root' },
      { path: '../secret.md', reason: 'unsafe_path' },
    ]);
  });
});
