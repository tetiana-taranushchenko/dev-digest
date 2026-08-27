/**
 * repo-intel pipeline — walk + filter (step 1+2).
 *
 * Walks a clone directory and returns the set of files the parse phase should
 * process, applying:
 *   - EXCLUDED_DIRS  (node_modules, dist, build, coverage, .next, out, vendor, .git)
 *   - SUPPORTED_EXT  (.ts, .tsx, .js, .jsx, .mjs, .cjs)
 *   - MAX_FILE_SIZE  (400 KB) — files larger than this are counted in
 *                    `stats.skippedTooLarge` and left out of the result.
 *   - MAX_INDEXED_FILES (5000) — if exceeded, take the FIRST N (by walk order)
 *                    and record `stats.bounded = total - N`. T3 will replace
 *                    "first N" with "top N by hotness" once `file_rank` lands.
 *
 * NOT YET HANDLED:
 *   - `.gitignore` filtering. Would require the `ignore` npm package; the
 *     EXCLUDED_DIRS list covers the heaviest dirs (node_modules, build outputs),
 *     so the practical loss is small. TODO(T3): wire `ignore` once we accept
 *     a new dep, OR honor `git ls-files` so we get .gitignore for free.
 *
 * Pure-ish: takes a root path + does fs ops; returns plain data so the caller
 * (full.ts / incremental.ts) can decide what to do with it.
 */
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import {
  EXCLUDED_DIRS,
  MAX_FILE_SIZE,
  MAX_INDEXED_FILES,
  SUPPORTED_EXT,
} from '../constants.js';

const EXCLUDED_SET: ReadonlySet<string> = new Set(EXCLUDED_DIRS);
const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_EXT);

export interface WalkStats {
  /** Files seen on disk with a SUPPORTED_EXT extension (before size + bound filters). */
  totalCandidates: number;
  /** Candidates dropped because stat().size > MAX_FILE_SIZE. */
  skippedTooLarge: number;
  /** Candidates dropped because the file list exceeded MAX_INDEXED_FILES. */
  bounded: number;
}

export interface WalkResult {
  /** Paths relative to `root`, separator-normalized to forward slashes. */
  files: string[];
  stats: WalkStats;
}

export interface WalkOptions {
  /**
   * File extensions to include (lowercase, with leading dot), e.g. `MARKDOWN_EXT`.
   * Defaults to `SUPPORTED_EXT` — today's exact behaviour.
   */
  extensions?: readonly string[];
  /**
   * Optional predicate over the posix-style path relative to `root` (the same
   * string that would land in `WalkResult.files`). Return `true` to keep the
   * file. Applied in addition to the extension/size/excluded-dir filters —
   * it never bypasses them. Defaults to accepting every candidate.
   */
  filter?: (relPath: string) => boolean;
}

/**
 * Recursively walk `root`, returning the file set to parse + a small stats
 * object the pipeline persists into `repo_index_state.stats`.
 *
 * `opts` is optional and defaults to today's exact behaviour (SUPPORTED_EXT,
 * no extra predicate) so existing callers (`full.ts`, `incremental.ts`) are
 * unaffected.
 */
export async function walkClone(root: string, opts?: WalkOptions): Promise<WalkResult> {
  const extSet = opts?.extensions ? new Set(opts.extensions) : SUPPORTED_SET;
  const filter = opts?.filter;
  const out: string[] = [];
  const stats: WalkStats = { totalCandidates: 0, skippedTooLarge: 0, bounded: 0 };

  await walkDir(root, root, out, stats, extSet, filter);

  // Stable order: alphabetical relpath. Keeps "first N when bounded" reproducible
  // across runs (until T3 replaces it with rank-driven selection).
  out.sort();

  if (out.length > MAX_INDEXED_FILES) {
    stats.bounded = out.length - MAX_INDEXED_FILES;
    out.length = MAX_INDEXED_FILES;
  }

  return { files: out, stats };
}

async function walkDir(
  root: string,
  dir: string,
  out: string[],
  stats: WalkStats,
  extSet: ReadonlySet<string>,
  filter: ((relPath: string) => boolean) | undefined,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true })) as Dirent[];
  } catch {
    // Unreadable directory (permissions, dangling symlink) — skip cleanly so
    // the indexer keeps making progress on the parts of the clone it CAN read.
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loops, perf)
    const name = entry.name;

    if (entry.isDirectory()) {
      if (EXCLUDED_SET.has(name)) continue;
      await walkDir(root, join(dir, name), out, stats, extSet, filter);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = extname(name).toLowerCase();
    if (!extSet.has(ext)) continue;

    stats.totalCandidates += 1;

    const full = join(dir, name);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_SIZE) {
      stats.skippedTooLarge += 1;
      continue;
    }

    // Posix-style relative path so DB rows are platform-agnostic (matches the
    // `pr_files.path` convention).
    const rel = relative(root, full).split(sep).join('/');
    if (filter && !filter(rel)) continue;
    out.push(rel);
  }
}
