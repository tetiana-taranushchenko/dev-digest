// REQ-13: on the stdio transport, stdout *is* the JSON-RPC wire, so a stray
// write there breaks the host with a JSON parse error. This test walks the
// real `src/` tree (never a hardcoded file list, so it can't go stale as
// files are added) and asserts no file writes to stdout.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '../src');

/** Recursively collects every `.ts` file under `dir`. */
function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('no stdout writes in src/', () => {
  const files = listTsFiles(SRC_DIR);

  it('found at least one source file to scan (sanity check on the walk itself)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no `console.log` calls anywhere in src/ (REQ-13)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (/console\.log\s*\(/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('contains no `process.stdout.write` calls anywhere in src/ (REQ-13)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, index) => {
        if (/process\.stdout\.write\s*\(/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
