import { posix } from 'node:path';
import type { SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_FILENAME_PATTERNS,
  BOILERPLATE_PATH_SEGMENTS,
  LOCKFILE_NAMES,
  ROLE_PRECEDENCE,
  WIRING_EXACT_FILENAMES,
  WIRING_EXTENSIONS,
  WIRING_FILENAME_PATTERNS,
  WIRING_PATH_SEGMENTS,
} from './constants.js';

/**
 * Smart Diff — pure path classifier (`classify.ts`, T2).
 *
 * `classifyPath` maps a changed file's path to exactly one `SmartDiffRole`.
 * Comparison happens on the POSIX-normalized, lower-cased path (see
 * `constants.ts`): filename rules match the file's **basename**, path rules
 * match a **whole path segment** (so `distribution/foo.ts` never matches the
 * `dist` segment). Precedence is driven by `ROLE_PRECEDENCE` —
 * `boilerplate` -> `wiring` -> `core` — first match wins, `core` is the
 * fallback when nothing else matches.
 */

/** Escapes every regex-special character in a single literal chunk. */
function escapeRegExpChar(char: string): string {
  return char.replace(/[.+?^$()|[\]\\]/g, '\\$&');
}

/**
 * Converts a basename glob pattern (`*` wildcard, `{a,b,c}` brace
 * expansion — the only two glob features used in `constants.ts`) into an
 * anchored `RegExp`.
 */
function globToRegExp(pattern: string): RegExp {
  let source = '';
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i]!;
    if (char === '*') {
      source += '.*';
      i += 1;
      continue;
    }
    if (char === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        source += escapeRegExpChar(char);
        i += 1;
        continue;
      }
      const options = pattern
        .slice(i + 1, end)
        .split(',')
        .map((option) => escapeRegExpChar(option));
      source += `(?:${options.join('|')})`;
      i = end + 1;
      continue;
    }
    source += escapeRegExpChar(char);
    i += 1;
  }
  return new RegExp(`^${source}$`);
}

/** Matches `basename` against any of `patterns` (basename-only glob match). */
function matchesAnyGlob(basename: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegExp(pattern.toLowerCase()).test(basename));
}

/** Whole-path-segment membership check (never a substring match). */
function hasSegment(segments: readonly string[], candidates: readonly string[]): boolean {
  const lowerCandidates = candidates.map((candidate) => candidate.toLowerCase());
  return segments.some((segment) => lowerCandidates.includes(segment));
}

function isBoilerplate(basename: string, segments: readonly string[]): boolean {
  if (LOCKFILE_NAMES.some((name) => name.toLowerCase() === basename)) return true;
  if (hasSegment(segments, BOILERPLATE_PATH_SEGMENTS)) return true;
  if (matchesAnyGlob(basename, BOILERPLATE_FILENAME_PATTERNS)) return true;
  return false;
}

function isWiring(basename: string, segments: readonly string[]): boolean {
  if (WIRING_EXACT_FILENAMES.some((name) => name.toLowerCase() === basename)) return true;
  if (matchesAnyGlob(basename, WIRING_FILENAME_PATTERNS)) return true;
  if (hasSegment(segments, WIRING_PATH_SEGMENTS)) return true;
  if (WIRING_EXTENSIONS.some((ext) => basename.endsWith(ext.toLowerCase()))) return true;
  return false;
}

/** Classifies a single changed file's path into a `SmartDiffRole`. */
export function classifyPath(path: string): SmartDiffRole {
  const normalized = posix.normalize(path.replace(/\\/g, '/')).toLowerCase();
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  const basename = segments.length > 0 ? segments[segments.length - 1]! : normalized;

  for (const role of ROLE_PRECEDENCE) {
    if (role === 'boilerplate' && isBoilerplate(basename, segments)) return role;
    if (role === 'wiring' && isWiring(basename, segments)) return role;
    if (role === 'core') return role;
  }
  return 'core';
}
