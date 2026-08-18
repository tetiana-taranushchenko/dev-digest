import type { SmartDiffRole } from '@devdigest/shared';

/**
 * Smart Diff — pure constants (no logic).
 *
 * Classification (`classify.ts`, T2) compares against these on the
 * POSIX-normalized, lower-cased path: filename rules match the **basename**,
 * path rules match a **whole path segment** (so `distribution/` never
 * matches `dist`). Precedence is `boilerplate` -> `wiring` -> `core`
 * (first match wins; `core` is the default) — `ROLE_PRECEDENCE` expresses
 * that order explicitly, separate from `ROLE_ORDER` (display/grouping order).
 */

/** Group emission order in the assembled `SmartDiff` (`assemble.ts`, T3). */
export const ROLE_ORDER: readonly SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/** Classification precedence — first match wins; `core` is the fallback. */
export const ROLE_PRECEDENCE: readonly SmartDiffRole[] = ['boilerplate', 'wiring', 'core'];

/** Exact lock file basenames — always classified as `boilerplate`. */
export const LOCKFILE_NAMES: readonly string[] = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'poetry.lock',
  'Cargo.lock',
  'go.sum',
];

/** Path segments that make a file `boilerplate` (whole-segment match only). */
export const BOILERPLATE_PATH_SEGMENTS: readonly string[] = [
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  'node_modules',
  'vendor',
  '__snapshots__',
  'generated',
];

/** Basename glob patterns that make a file `boilerplate`. */
export const BOILERPLATE_FILENAME_PATTERNS: readonly string[] = [
  '*.snap',
  '*.min.js',
  '*.map',
  '*.generated.*',
];

/** Exact basenames that make a file `wiring`. */
export const WIRING_EXACT_FILENAMES: readonly string[] = [
  'package.json',
  'dockerfile',
  'docker-compose.yml',
  '.env.example',
];

/** Basename glob patterns that make a file `wiring`. */
export const WIRING_FILENAME_PATTERNS: readonly string[] = [
  'index.{ts,tsx,js,jsx,mjs,cjs}',
  '*.config.{ts,js,mjs,cjs,json}',
  'tsconfig*.json',
];

/** Path segments that make a file `wiring` (whole-segment match only). */
export const WIRING_PATH_SEGMENTS: readonly string[] = ['.github', 'migrations'];

/** File extensions that make a file `wiring`. */
export const WIRING_EXTENSIONS: readonly string[] = [
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.json',
  '.md',
];

/** `core` + `wiring` line total above which `split_suggestion.too_big` is true. */
export const SPLIT_TOO_BIG_LINES = 400;

/** Minimum files a top-level-directory group must have to be proposed as a split. */
export const SPLIT_MIN_FILES_PER_GROUP = 2;

/** Maximum number of proposed splits returned, after sorting by line count desc. */
export const MAX_PROPOSED_SPLITS = 3;
