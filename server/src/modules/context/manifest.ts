import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentManifest } from '@devdigest/shared';
import { isWithin, safeRepoPath } from '../_shared/path-safety.js';
import { MAX_FILE_SIZE } from '../repo-intel/constants.js';

/**
 * CI/runner-path resolver for `AgentManifest.context` (AC-21,
 * `docs/plans/project-context.md` T5).
 *
 * The manifest is written by the studio (`CiService.agentYaml`, not yet
 * implemented) to `.devdigest/agents/<slug>.yaml` and is documented to be
 * read back by a future CI/agent-runner. That manifest already resolves
 * `skills` slugs to `.devdigest/skills/<slug>.md`
 * (`server/src/vendor/shared/contracts/eval-ci.ts:145-151`); this module is
 * the mirror-image resolver for `manifest.context`, which stores
 * repo-relative paths directly (no slug templating needed).
 *
 * IMPORTANT — per Recommendation 4 of the Development Plan
 * (`docs/plans/project-context.md`), **no call-site for this function exists
 * anywhere in this repo yet.** There is no `CiService`, no
 * `POST /agents/:id/export-ci` route, and no runner package
 * (`grep -rn "AgentManifest\|agentYaml\|export-ci" server/src client/src
 * reviewer-core/src` returns only the contract itself and a comment in
 * `reviewer-core/src/review/run.ts`). This file ships the pure resolver only,
 * ready for a future runner to import; wiring it up is explicitly out of
 * scope for this task.
 *
 * Security-critical invariant (NFR "path containment"): every read goes
 * through `safeRepoPath` + `isWithin`
 * (`server/src/modules/_shared/path-safety.ts:9-21`), the same pattern used
 * by `intent/signals.ts` and `conventions/extractor.ts`. This module must
 * NOT copy or call the unguarded `readClone` in
 * `server/src/modules/repo-intel/service.ts:923-925` (a bare
 * `readFile(join(clonePath, file))`).
 *
 * No DB, no `Container` — a plain function so a future runner (which will
 * have neither) can call it directly.
 */

/** A `manifest.context` path that resolved to a readable document body. */
export interface ResolvedManifestContextDoc {
  /** Normalized repo-relative path (as returned by `safeRepoPath`). */
  path: string;
  body: string;
}

/** Why a `manifest.context` entry was skipped instead of thrown (AC-14). */
export type ManifestContextSkipReason =
  | 'unsafe_path'
  | 'outside_root'
  | 'not_found'
  | 'not_a_file'
  | 'too_large'
  | 'unreadable';

export interface SkippedManifestContextDoc {
  /** The raw path as it appeared in `manifest.context` (may be malformed). */
  path: string;
  reason: ManifestContextSkipReason;
}

export interface ResolveManifestContextResult {
  /** Successfully read documents, in `manifest.context` order. */
  resolved: ResolvedManifestContextDoc[];
  /** Entries that could not be resolved — reported, never thrown. */
  skipped: SkippedManifestContextDoc[];
}

/**
 * Resolve every path in `manifest.context` to its document body, reading
 * fresh from `checkoutRoot` (a CI checkout / repo clone directory) with no
 * caching. An unresolvable, out-of-root, non-file, oversized, or unreadable
 * path is skipped and reported in `skipped` — this function never throws for
 * a bad individual path (AC-14 semantics); it only rejects if `checkoutRoot`
 * itself cannot be resolved at all, in which case every path is reported
 * skipped with `not_found`.
 */
export async function resolveManifestContext(
  manifest: Pick<AgentManifest, 'context'>,
  checkoutRoot: string,
): Promise<ResolveManifestContextResult> {
  const resolved: ResolvedManifestContextDoc[] = [];
  const skipped: SkippedManifestContextDoc[] = [];

  if (manifest.context.length === 0) return { resolved, skipped };

  let root: string;
  try {
    root = await realpath(checkoutRoot);
  } catch {
    for (const path of manifest.context) skipped.push({ path, reason: 'not_found' });
    return { resolved, skipped };
  }

  for (const rawPath of manifest.context) {
    const doc = await resolveOne(root, rawPath);
    if (doc.ok) resolved.push({ path: doc.path, body: doc.body });
    else skipped.push({ path: rawPath, reason: doc.reason });
  }

  return { resolved, skipped };
}

type ResolveOneResult =
  | { ok: true; path: string; body: string }
  | { ok: false; reason: ManifestContextSkipReason };

/**
 * Resolve and read a single `manifest.context` entry, containment-checked
 * BEFORE and AFTER `realpath` (so a symlink cannot escape `root` even if the
 * literal path looked safe) — mirrors `conventions/extractor.ts:readSample`
 * and `intent/signals.ts:verifyContainment`.
 */
async function resolveOne(root: string, rawPath: string): Promise<ResolveOneResult> {
  const safePath = safeRepoPath(rawPath);
  if (!safePath) return { ok: false, reason: 'unsafe_path' };

  const requested = resolve(root, safePath);
  if (!isWithin(root, requested)) return { ok: false, reason: 'outside_root' };

  let actual: string;
  try {
    actual = await realpath(requested);
  } catch {
    return { ok: false, reason: 'not_found' };
  }
  if (!isWithin(root, actual)) return { ok: false, reason: 'outside_root' };

  let fileStat;
  try {
    fileStat = await stat(actual);
  } catch {
    return { ok: false, reason: 'not_found' };
  }
  if (!fileStat.isFile()) return { ok: false, reason: 'not_a_file' };
  if (fileStat.size > MAX_FILE_SIZE) return { ok: false, reason: 'too_large' };

  const body = await readFile(actual, 'utf8').catch(() => null);
  if (body == null || body.includes('\0')) return { ok: false, reason: 'unreadable' };

  return { ok: true, path: safePath, body };
}
