import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isWritablePath, validateEntryPath } from '../src/modules/context/write-safety.js';
import {
  ensureWriteRoot,
  findCollision,
  resolveWriteTarget,
  writeAtomic,
} from '../src/modules/context/write-fs.js';

const tempDirs: string[] = [];

async function tempClone(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'devdigest-write-'));
  tempDirs.push(root);
  return root;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Project Context write safety', () => {
  it.each([
    ['../escape.md', 'invalid_path'],
    ['/absolute.md', 'invalid_path'],
    ['folder\\escape.md', 'invalid_path'],
    ['bad\0name.md', 'control_char'],
    [`.${'a'.repeat(100)}.md`, 'leading_dot'],
    [`${'a'.repeat(101)}.md`, 'segment_too_long'],
    ['notes.txt', 'invalid_extension'],
    ['.hidden.md', 'leading_dot'],
  ])('rejects unsafe file path %j', (path, reason) => {
    expect(validateEntryPath(path, 'file')).toEqual({ ok: false, reason });
  });

  it('reports only the configured write root as writable', () => {
    expect(isWritablePath('.devdigest/specs/a.md')).toBe(true);
    expect(isWritablePath('docs/a.md')).toBe(false);
    expect(isWritablePath('../.devdigest/specs/a.md')).toBe(false);
  });

  it('rejects a symlink anywhere in the write target ancestry', async () => {
    const root = await tempClone();
    const outside = await tempClone();
    await mkdir(join(root, '.devdigest'), { recursive: true });
    await mkdir(join(outside, 'specs'), { recursive: true });
    await symlink(join(outside, 'specs'), join(root, '.devdigest/specs'));

    expect(await ensureWriteRoot(root)).toEqual({ ok: false, reason: 'symlink_escape' });
    expect(await resolveWriteTarget(root, 'x.md', 'file')).toEqual({ ok: false, reason: 'symlink_escape' });
    expect(await readdir(join(outside, 'specs'))).toEqual([]);
  });

  it('detects case-insensitive collisions without overwriting', async () => {
    const root = await tempClone();
    const dir = join(root, '.devdigest/specs');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'Spec.md'), 'original');

    expect(await findCollision(dir, 'spec.md')).toBe(true);
    expect(await readFile(join(dir, 'Spec.md'), 'utf8')).toBe('original');
  });

  it('atomically replaces a document and leaves no temporary file', async () => {
    const root = await tempClone();
    const dir = join(root, '.devdigest/specs');
    const target = join(dir, 'a.md');
    await mkdir(dir, { recursive: true });
    await writeFile(target, 'old');

    await writeAtomic(target, 'new complete body');

    expect(await readFile(target, 'utf8')).toBe('new complete body');
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
