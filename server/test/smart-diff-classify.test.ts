/**
 * Smart Diff path classifier (`modules/smart-diff/classify.ts`, T2) — pure
 * `path -> SmartDiffRole` mapping. Precedence is boilerplate -> wiring ->
 * core (`ROLE_PRECEDENCE`, `constants.ts`); all patterns/thresholds live in
 * `constants.ts` (REQ-2), never inline here.
 */
import { describe, it, expect } from 'vitest';
import { classifyPath } from '../src/modules/smart-diff/classify.js';
import { LOCKFILE_NAMES } from '../src/modules/smart-diff/constants.js';

describe('classifyPath', () => {
  it('classifies every lock file as boilerplate', () => {
    for (const name of LOCKFILE_NAMES) {
      expect(classifyPath(name)).toBe('boilerplate');
      expect(classifyPath(`nested/dir/${name}`)).toBe('boilerplate');
    }
  });

  it('classifies dist/ and *.snap as boilerplate', () => {
    expect(classifyPath('packages/app/dist/bundle.js')).toBe('boilerplate');
    expect(classifyPath('dist/index.js')).toBe('boilerplate');
    expect(classifyPath('src/__tests__/__snapshots__/Foo.test.tsx.snap')).toBe('boilerplate');
    expect(classifyPath('src/components/Foo.test.tsx.snap')).toBe('boilerplate');
  });

  it('classifies index.ts and *.config.ts as wiring', () => {
    expect(classifyPath('src/index.ts')).toBe('wiring');
    expect(classifyPath('src/modules/foo/index.ts')).toBe('wiring');
    expect(classifyPath('vite.config.ts')).toBe('wiring');
    expect(classifyPath('client/vitest.config.ts')).toBe('wiring');
  });

  it('classifies src business logic as core', () => {
    expect(classifyPath('server/src/modules/pulls/service.ts')).toBe('core');
    expect(classifyPath('client/src/components/diff-viewer/DiffViewer.tsx')).toBe('core');
  });

  it('does not match distribution/ as dist', () => {
    expect(classifyPath('distribution/foo.ts')).not.toBe('boilerplate');
    expect(classifyPath('distribution/foo.ts')).toBe('core');
  });

  it('classifies path-segment wiring rules (.github, migrations) and wiring extensions', () => {
    expect(classifyPath('.github/workflows/ci.yml')).toBe('wiring');
    expect(classifyPath('server/src/db/migrations/0001_init.sql')).toBe('wiring');
    expect(classifyPath('docs/plans/smart-diff.md')).toBe('wiring');
    expect(classifyPath('server/package.json')).toBe('wiring');
  });

  it('applies boilerplate before wiring when both could match (precedence)', () => {
    // Inside a boilerplate directory, even a wiring-shaped filename stays boilerplate.
    expect(classifyPath('dist/index.js')).toBe('boilerplate');
  });

  it('classifies *.min.js and *.generated.* filename patterns as boilerplate', () => {
    expect(classifyPath('src/vendor/bundle.min.js')).toBe('boilerplate');
    expect(classifyPath('src/api/client.generated.ts')).toBe('boilerplate');
  });

  it('classifies non-.ts variants of the index and *.config brace-expansions, and tsconfig*.json, as wiring', () => {
    expect(classifyPath('src/components/index.jsx')).toBe('wiring');
    expect(classifyPath('vite.config.mjs')).toBe('wiring');
    expect(classifyPath('tsconfig.json')).toBe('wiring');
    expect(classifyPath('tsconfig.build.json')).toBe('wiring');
  });

  it('classifies .yaml, .toml, .ini extensions as wiring, and a non-package.json .json file via the generic extension fallback', () => {
    expect(classifyPath('.github/workflows/ci.yaml')).toBe('wiring');
    expect(classifyPath('pyproject.toml')).toBe('wiring');
    expect(classifyPath('src/config/settings.ini')).toBe('wiring');
    // Not package.json, not tsconfig*.json, not *.config.json — only the generic
    // WIRING_EXTENSIONS `.json` entry can classify this as wiring.
    expect(classifyPath('src/data/manifest.json')).toBe('wiring');
  });
});
