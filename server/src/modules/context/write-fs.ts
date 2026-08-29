import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isWithin } from '../_shared/path-safety.js';
import { CONTEXT_WRITE_ROOT, MAX_FILE_SIZE } from './constants.js';
import { revisionOf, validateEntryPath, type WriteRejectReason } from './write-safety.js';

/**
 * write-fs — the filesystem-effect half of Project Context authoring (T3,
 * `docs/plans/project-context-authoring.md`). **Filesystem effects only: the
 * clone root is always an argument, never resolved here** — no `Container`,
 * no DB, no repo lookup — so every export is testable against a plain
 * `mkdtemp` directory. Builds its containment checks on top of T2's
 * `write-safety.ts` (`validateEntryPath`, `revisionOf`) and the shared
 * `isWithin` helper (`_shared/path-safety.ts`).
 *
 * Security invariant (plan "Security invariant" section): every write target
 * is derived as `validateEntryPath` (rejects `.devdigest` ever appearing as a
 * user-supplied segment, since it rejects any leading dot) ->
 * `resolve(writeRoot, rel)` -> `isWithin(cloneRoot, abs)` ->
 * `isWithin(writeRoot, abs)` -> `realpath` of the deepest *existing* ancestor
 * -> compared against its own literal path (AC-19: ANY symlink anywhere in
 * the resolution is rejected, not only one that escapes containment) ->
 * `isWithin` again as a defense-in-depth backstop, and only then a
 * filesystem call. **Never a bare `join()` for a write target, and no
 * function here follows a symlink without re-checking the result** — the one
 * exception, `join(cloneRoot, CONTEXT_WRITE_ROOT)`, joins a fixed module
 * constant onto an already-trusted root (not user input) and is commented at
 * each use.
 */

/** The absolute `.devdigest/specs` directory under a given clone root. */
function writeRootOf(cloneRoot: string): string {
  // Permitted `join()`: CONTEXT_WRITE_ROOT is a fixed constant, not
  // user-controlled input, and cloneRoot is the caller's trusted root.
  return join(cloneRoot, CONTEXT_WRITE_ROOT);
}

/**
 * Walk upward from `absPath`'s parent directory until an entry that actually
 * exists on disk is found (following symlinks, via `stat`), returning that
 * directory's literal (non-realpath'd) path. Never throws — if nothing above
 * `absPath` exists (shouldn't happen once `cloneRoot` itself is guaranteed to
 * exist by the caller), it terminates at the filesystem root.
 */
async function deepestExistingAncestor(absPath: string): Promise<string> {
  let dir = dirname(absPath);
  for (;;) {
    try {
      await stat(dir);
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return dir; // reached the filesystem root; give up gracefully
      dir = parent;
    }
  }
}

export type ResolveWriteTargetResult =
  | { ok: true; abs: string; path: string }
  | { ok: false; reason: WriteRejectReason };

/**
 * Resolve a raw, untrusted path — relative to the write root, e.g. `a.md` or
 * `api/public.md` (AC-17: "a relative path of one or more segments beneath
 * that root") — into an absolute write target, or reject it (AC-17, AC-18,
 * AC-19). Runs T2's `validateEntryPath` (which itself rejects a leading dot
 * on any segment, so `.devdigest` can never be smuggled in through
 * `relPath` — the write root prefix below is the one trusted, non-user
 * segment), resolves against the write root, re-checks containment against
 * both the clone root and the write root, then `realpath`s the deepest
 * *existing* ancestor of the target and re-checks containment on that
 * resolved value — so a symlinked `.devdigest`, `.devdigest/specs`, or any
 * intermediate folder along the path is rejected even though the literal
 * (unresolved) path looked safe.
 */
export async function resolveWriteTarget(
  cloneRoot: string,
  relPath: string,
  kind: 'file' | 'folder',
): Promise<ResolveWriteTargetResult> {
  const validated = validateEntryPath(relPath, kind);
  if (!validated.ok) return validated;

  const writeRoot = writeRootOf(cloneRoot);
  const abs = resolve(writeRoot, validated.path);
  if (!isWithin(cloneRoot, abs)) return { ok: false, reason: 'outside_root' };
  if (!isWithin(writeRoot, abs)) return { ok: false, reason: 'outside_write_root' };

  const rejection = await rejectIfAncestorIsSymlinked(cloneRoot, abs);
  if (rejection) return rejection;

  return { ok: true, abs, path: validated.path };
}

/**
 * AC-19 is unconditional — "IF a write target resolves through a symlink,
 * THEN the system shall reject it" — not merely "if it escapes containment".
 * `realpath`s the deepest *existing* ancestor of `abs` and compares it
 * against its own literal (unresolved) path: any difference means a symlink
 * was traversed somewhere along the way (`.devdigest`, `.devdigest/specs`,
 * or any intermediate folder), which is rejected outright regardless of
 * where it ultimately points. Falls back to an `isWithin(cloneRoot, …)`
 * check as well, matching the plan's explicit "isWithin again" step.
 */
async function rejectIfAncestorIsSymlinked(
  cloneRoot: string,
  abs: string,
): Promise<{ ok: false; reason: WriteRejectReason } | null> {
  const ancestor = await deepestExistingAncestor(abs);
  let realAncestor: string;
  try {
    realAncestor = await realpath(ancestor);
  } catch {
    // Vanished between the stat above and realpath here — reject
    // conservatively rather than risk resolving through a race.
    return { ok: false, reason: 'symlink_escape' };
  }
  if (realAncestor !== ancestor) return { ok: false, reason: 'symlink_escape' };
  if (!isWithin(cloneRoot, realAncestor)) return { ok: false, reason: 'symlink_escape' };
  return null;
}

export type EnsureWriteRootResult = { ok: true; abs: string } | { ok: false; reason: WriteRejectReason };

/**
 * Create `.devdigest/specs` under `cloneRoot` if it does not exist yet
 * (AC-17), then re-verify containment on the realpath'd result so a
 * pre-existing symlinked `.devdigest` (or `.devdigest/specs`) is rejected
 * instead of silently writing through it.
 *
 * Containment is checked on the deepest *existing* ancestor **before**
 * `mkdir(..., { recursive: true })` runs, not after: `mkdir` follows
 * symlinks like any other fs call, so checking only afterwards would let a
 * pre-existing malicious symlink (e.g. `.devdigest` pointing outside the
 * clone) get a real directory created through it before the rejection ever
 * fires.
 */
export async function ensureWriteRoot(cloneRoot: string): Promise<EnsureWriteRootResult> {
  const writeRoot = writeRootOf(cloneRoot);

  const preCheck = await rejectIfAncestorIsSymlinked(cloneRoot, writeRoot);
  if (preCheck) return preCheck;

  await mkdir(writeRoot, { recursive: true });

  // Post-check too: `mkdir` itself follows symlinks like any other fs call,
  // and this closes the (unavoidable without atomic mkdir-if-safe
  // primitives) race between the pre-check above and the mkdir call.
  let real: string;
  try {
    real = await realpath(writeRoot);
  } catch {
    return { ok: false, reason: 'symlink_escape' };
  }
  if (real !== writeRoot || !isWithin(cloneRoot, real)) return { ok: false, reason: 'symlink_escape' };

  return { ok: true, abs: real };
}

/**
 * True iff `dirAbs` already contains an entry whose name matches `name`
 * case-insensitively (AC-16) — so `Spec.md` collides with an existing
 * `spec.md` on any filesystem, not just a case-insensitive one. A directory
 * that does not exist yet has no entries to collide with.
 */
export async function findCollision(dirAbs: string, name: string): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readdir(dirAbs);
  } catch {
    return false;
  }
  return entries.some((entry) => entry.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0);
}

/**
 * Write `content` to `targetAbs` atomically (AC-11): write to a temp file in
 * the *same directory* as the target (so `rename()` is an atomic same-
 * filesystem operation), then rename over the target. The temp file is
 * unlinked in a `finally` so a failed write/rename never leaves a partial
 * document AND never leaves a stray temp file — the `unlink` after a
 * successful `rename` simply no-ops (the temp path no longer exists) and is
 * swallowed. The suffix is deliberately not `.md`, so `walkClone`'s
 * `MARKDOWN_EXT` filter never discovers it mid-write.
 *
 * For the deliberate-overwrite save path only — never use this for a create,
 * which must use `createNewFile`'s `wx` flag instead (TOCTOU risk: `rename()`
 * overwrites silently).
 */
export async function writeAtomic(targetAbs: string, content: string): Promise<void> {
  const dir = dirname(targetAbs);
  const base = basename(targetAbs);
  // Permitted `join()`: temp-file naming inside `dir`, which is the already
  // validated/resolved target's own directory — not a join against
  // user-controlled input.
  const tmpPath = join(dir, `.${base}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmpPath, content, 'utf8');
    await rename(tmpPath, targetAbs);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Create a brand-new, empty file at `targetAbs`. Uses the `wx` flag so an
 * existing file is never truncated (AC-16 belt-and-braces alongside
 * `findCollision`'s case-insensitive check — `wx` alone catches an
 * exact-case collision atomically even on case-sensitive filesystems where
 * `findCollision` would otherwise be racy).
 */
export async function createNewFile(targetAbs: string): Promise<void> {
  await writeFile(targetAbs, '', { flag: 'wx' });
}

/** Create a new, empty folder at `targetAbs`. Throws if it already exists. */
export async function createFolder(targetAbs: string): Promise<void> {
  await mkdir(targetAbs);
}

export type ReadDocumentAtReason = 'not_found' | 'not_a_file' | 'too_large' | 'unreadable';

export type ReadDocumentAtResult =
  | { ok: true; content: string; size: number; mtime: Date; revision: string }
  | { ok: false; reason: ReadDocumentAtReason };

/**
 * Read a document at an already-resolved, already-containment-checked
 * absolute path (AC-4, AC-20). Reuses the exact `stat` -> `MAX_FILE_SIZE` ->
 * `readFile` -> NUL-check sequence already used by `service.ts`'s `readOne`
 * (`service.ts:220-232`), plus a content-addressed `revision` (T2's
 * `revisionOf`) so callers get optimistic-concurrency data in one read.
 * Containment/symlink-escape checks are the caller's responsibility
 * (`resolveWriteTarget` for writes, the existing `readOne`-style checks for
 * general reads) — this function does no path resolution of its own.
 */
export async function readDocumentAt(absPath: string): Promise<ReadDocumentAtResult> {
  let fileStat;
  try {
    fileStat = await stat(absPath);
  } catch {
    return { ok: false, reason: 'not_found' };
  }
  if (!fileStat.isFile()) return { ok: false, reason: 'not_a_file' };
  if (fileStat.size > MAX_FILE_SIZE) return { ok: false, reason: 'too_large' };

  const content = await readFile(absPath, 'utf8').catch(() => null);
  if (content == null || content.includes('\0')) return { ok: false, reason: 'unreadable' };

  return { ok: true, content, size: fileStat.size, mtime: fileStat.mtime, revision: revisionOf(content) };
}
