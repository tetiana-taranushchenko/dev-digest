/**
 * context module constants (T7, `docs/plans/project-context.md`).
 */
import { MAX_FILE_SIZE as REPO_INTEL_MAX_FILE_SIZE } from '../repo-intel/constants.js';

/**
 * Oversized-document cutoff (AC-20) — NOT a new number. It is the exact
 * 400 KB limit repo-intel's `walkClone` already enforces during discovery
 * (`repo-intel/constants.ts:43`), re-exported here so `readBodies`' own
 * fresh, uncached reads (a separate code path from the discovery walk) stay
 * locked to the same single source of truth rather than drifting from it.
 *
 * Reused unchanged for the write path's AC-20 (a save body or upload over
 * this limit is rejected before any write): `write-safety.ts`/`write-fs.ts`
 * import this same constant rather than defining a second size limit.
 */
export const MAX_FILE_SIZE = REPO_INTEL_MAX_FILE_SIZE;

/**
 * The one directory the write endpoints (save/create/upload) are allowed to
 * target (REQ-4, AC-17, AC-24) — created if absent. Repo-relative, POSIX
 * separators, no leading/trailing slash, matching how `safeRepoPath`
 * produces and compares paths elsewhere in this module.
 */
export const CONTEXT_WRITE_ROOT = '.devdigest/specs';

/**
 * Longest a single path segment (a file or folder name, not a full relative
 * path) may be, in characters (AC-18).
 */
export const NAME_SEGMENT_MAX = 100;

/**
 * Allowed characters for a single path segment (AC-18): ASCII letters,
 * digits, `.`, `_`, `-`. Deliberately does not by itself forbid a leading
 * dot (`.` is a member of the class) — `validateEntryPath` in
 * `write-safety.ts` rejects a leading dot as a separate, more specific
 * check so routes/logs can report the precise reason.
 */
export const NAME_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Soft token-budget warning threshold for a combined attached-document set
 * (AC-11). Server-owned (Development Plan Recommendation 2) — modelled on
 * `DEFAULT_REPO_MAP_TOKEN_BUDGET` (`repo-intel/constants.ts:51`) — so the
 * client reads one number instead of hard-coding its own copy. This is a
 * WARNING threshold only: exceeding it never blocks attaching a document or
 * running an agent (AC-11). 4000 matches the "4K soft cap" figure the spec's
 * own map-reduce cost-repeats example uses
 * (`specs/2026-08-26-project-context.md:279`).
 */
export const CONTEXT_TOKEN_CAP = 4000;
