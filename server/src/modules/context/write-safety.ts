import { createHash } from 'node:crypto';
import { safeRepoPath } from '../_shared/path-safety.js';
import { CONTEXT_WRITE_ROOT, NAME_SEGMENT_MAX, NAME_SEGMENT_RE } from './constants.js';

/**
 * write-safety — the AC-18/AC-24 rulebook for Project Context authoring (T2,
 * `docs/plans/project-context-authoring.md`). **Pure functions only: no
 * filesystem module import, no `Container`, no DB, no filesystem effect of
 * any kind.**
 * Everything here is a plain string/hash computation so it can be
 * exhaustively unit-tested with plain strings — no `mkdtemp`, no repo clone
 * — and so `write-fs.ts` (T3, which DOES touch the filesystem) can build its
 * containment/symlink checks on top of `validateEntryPath` without
 * duplicating the naming rules.
 *
 * `WriteRejectReason` below is the single source of truth for every reject
 * reason across the whole write pipeline (this file, `write-fs.ts`'s
 * containment/collision checks, and `service.ts`'s size check) — routes and
 * logs quote `writeRejectMessage()` rather than inventing ad hoc strings, so
 * the observability NFR ("one log line per write attempt, reason included,
 * never the document body") has exactly one place reasons are worded.
 */

/**
 * Every way a write target can be rejected, across the full write pipeline:
 * - `invalid_path` / `leading_dot` / `control_char` / `invalid_segment` /
 *   `segment_too_long` / `invalid_extension` — produced here, by
 *   `validateEntryPath` (pure, no I/O).
 * - `outside_root` / `outside_write_root` / `symlink_escape` — produced by
 *   `write-fs.ts`'s `resolveWriteTarget` once a clone root exists to resolve
 *   against (AC-17, AC-19).
 * - `collision` — produced by `write-fs.ts`'s `findCollision` (AC-16).
 * - `too_large` — produced by `service.ts`'s pre-write size check (AC-20).
 */
export type WriteRejectReason =
  | 'invalid_path'
  | 'leading_dot'
  | 'control_char'
  | 'invalid_segment'
  | 'segment_too_long'
  | 'invalid_extension'
  | 'outside_root'
  | 'outside_write_root'
  | 'symlink_escape'
  | 'collision'
  | 'too_large';

/** One human-readable message per `WriteRejectReason` — the sole wording source. */
const WRITE_REJECT_MESSAGES: Readonly<Record<WriteRejectReason, string>> = {
  invalid_path:
    'Path must be a relative path with no absolute prefix, backslash, empty segment, "." or "..".',
  leading_dot: 'A path segment may not start with a dot.',
  control_char: 'Path contains a control character.',
  invalid_segment: 'A path segment may only contain letters, digits, ".", "_", and "-".',
  segment_too_long: `A path segment may not exceed ${NAME_SEGMENT_MAX} characters.`,
  invalid_extension: 'File name must end in ".md".',
  outside_root: 'Resolved path is outside the repository clone.',
  outside_write_root: `Resolved path is outside the write root ("${CONTEXT_WRITE_ROOT}").`,
  symlink_escape: 'Resolved path escapes the allowed directory through a symlink.',
  collision: 'A file or folder with that name already exists (names are compared case-insensitively).',
  too_large: 'Content exceeds the maximum allowed size.',
};

/** Look up the one human message for a `WriteRejectReason` (routes/logs quote this). */
export function writeRejectMessage(reason: WriteRejectReason): string {
  return WRITE_REJECT_MESSAGES[reason];
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // ASCII control range (includes NUL) plus DEL -- written as numeric
    // comparisons, not a regex escape, so no raw control byte ever needs to
    // be embedded in this source file.
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Validate a raw, untrusted repo-relative path for a write (AC-17, AC-18).
 * Builds on `safeRepoPath` (`_shared/path-safety.ts:15-21`, which already
 * rejects an absolute path, a backslash, `..`, `.` and an empty segment) and
 * additionally rejects: a leading dot on any segment, any control character
 * (including `\0`), a segment failing `NAME_SEGMENT_RE` or longer than
 * `NAME_SEGMENT_MAX`, and — for `kind: 'file'` — a name not ending in `.md`.
 * Multi-segment relative paths (e.g. `api/public.md`) are allowed; every
 * segment is validated identically (AC-17).
 *
 * Pure normalization only — this does NOT resolve against a clone root or
 * touch the filesystem; containment/symlink checks belong to `write-fs.ts`.
 */
export function validateEntryPath(
  raw: string,
  kind: 'file' | 'folder',
): { ok: true; path: string } | { ok: false; reason: WriteRejectReason } {
  if (hasControlChar(raw)) {
    return { ok: false, reason: 'control_char' };
  }

  const safePath = safeRepoPath(raw);
  if (!safePath) {
    return { ok: false, reason: 'invalid_path' };
  }

  const segments = safePath.split('/');
  for (const segment of segments) {
    if (segment.startsWith('.')) {
      return { ok: false, reason: 'leading_dot' };
    }
    if (segment.length > NAME_SEGMENT_MAX) {
      return { ok: false, reason: 'segment_too_long' };
    }
    if (!NAME_SEGMENT_RE.test(segment)) {
      return { ok: false, reason: 'invalid_segment' };
    }
  }

  if (kind === 'file' && !safePath.toLowerCase().endsWith('.md')) {
    return { ok: false, reason: 'invalid_extension' };
  }

  return { ok: true, path: safePath };
}

/**
 * True iff a repo-relative path is under `CONTEXT_WRITE_ROOT` (AC-24) —
 * drives `ContextDocument.writable`, which the client uses to visibly
 * disable Edit for a document outside the write root instead of failing at
 * save time. An invalid path (per `safeRepoPath`) is never writable.
 */
export function isWritablePath(repoRelPath: string): boolean {
  const safePath = safeRepoPath(repoRelPath);
  if (!safePath) return false;
  return safePath === CONTEXT_WRITE_ROOT || safePath.startsWith(`${CONTEXT_WRITE_ROOT}/`);
}

/**
 * Content-addressed revision token for optimistic-concurrency saves (AC-9,
 * Recommendation 2) — a SHA-256 hex digest of the exact on-disk content, not
 * `mtime`+`size` (mtime has millisecond granularity; two saves in the same
 * millisecond producing the same byte count would otherwise collide).
 */
export function revisionOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
