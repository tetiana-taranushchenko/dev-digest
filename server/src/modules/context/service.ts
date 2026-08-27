import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import type {
  ContextDocument,
  ContextIndexStatus,
  ContextListing,
  ContextSource,
  CreateContextEntryResult,
  SaveContextDocumentResult,
  SpecFile,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { isWithin, safeRepoPath } from '../_shared/path-safety.js';
import { RepoRepository } from '../repos/repository.js';
import { walkClone } from '../repo-intel/pipeline/walk.js';
import { CONTEXT_FOLDERS, MARKDOWN_EXT } from '../repo-intel/constants.js';
import { CONTEXT_WRITE_ROOT, MAX_FILE_SIZE } from './constants.js';
import { ContextDocsRepository } from './repository.js';
import type {
  ContextDocSkipReason,
  ContextDocsFacade,
  CreateContextEntryInput,
  ReadBodiesResult,
  SaveContextDocumentInput,
  UploadContextDocumentInput,
} from './types.js';
import {
  createFolder,
  createNewFile,
  ensureWriteRoot,
  findCollision,
  readDocumentAt,
  resolveWriteTarget,
  writeAtomic,
  type ReadDocumentAtReason,
} from './write-fs.js';
import { isWritablePath, revisionOf, writeRejectMessage, type WriteRejectReason } from './write-safety.js';

/**
 * ContextDocsService — the application ring for Project Context (T7,
 * `docs/plans/project-context.md`). Coordinates the filesystem (via T3's
 * `walkClone`), the two link tables (via T4's `ContextDocsRepository`), and
 * the tokenizer adapter; computes the derived values (token estimate,
 * `used_by`, injection order/dedupe) that make this a real application-ring
 * service rather than a pass-through.
 *
 * Every filesystem read goes through `readOne` below, which mirrors
 * `conventions/extractor.ts:readSample` and `context/manifest.ts:resolveOne`
 * — `safeRepoPath` + `isWithin`, checked both before and after `realpath` so
 * a symlink can't escape the repo root even if the literal path looked safe.
 * This module must NOT use or imitate the unguarded `readClone`
 * (`repo-intel/service.ts:923-925`, a bare `readFile(join(clonePath, file))`).
 */
export class ContextDocsService implements ContextDocsFacade {
  private repos: RepoRepository;
  private contextDocs: ContextDocsRepository;

  constructor(private container: Container) {
    this.repos = new RepoRepository(container.db);
    this.contextDocs = new ContextDocsRepository(container.db);
  }

  /**
   * (a) List every discovered markdown document for a repo, plus index
   * freshness. Missing/unreadable clone → an index-unavailable result naming
   * the cause (AC-5), never a thrown error and never a silently empty list.
   */
  async listDocuments(workspaceId: string, repoId: string): Promise<ContextListing> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    if (!repo.clonePath) {
      return unavailableListing('Repository has not been cloned yet.');
    }

    let root: string;
    try {
      root = await realpath(repo.clonePath);
    } catch {
      return unavailableListing('Repository clone is missing on disk. Re-index the repository.');
    }

    const walkResult = await walkClone(root, {
      extensions: MARKDOWN_EXT,
      filter: (relPath) => classifyFolder(relPath) !== null,
    });

    // "used by N agents" — direct attachments plus every enabled-linked-skill
    // attachment, deduped per agent (`repository.ts#countAgentsByPath`).
    const usedBy = await this.contextDocs.countAgentsByPath(workspaceId);

    const files: SpecFile[] = [];
    for (const relPath of walkResult.files) {
      const folder = classifyFolder(relPath);
      if (!folder) continue; // defensive; the walk `filter` above already enforces this

      const doc = await this.readOne(root, relPath);
      if (!doc.ok) continue; // vanished/became unreadable between walk and read — skip, don't fail the listing

      files.push({
        path: doc.path,
        // NFR "list without bodies" — the listing response never carries
        // document content, only metadata; bodies are read fresh at
        // attach-preview/run time via `readBodies`.
        content: null,
        size: doc.size,
        updated_at: doc.updatedAt.toISOString(),
        source: FOLDER_TO_SOURCE[folder],
        // NFR "cost transparency" — the same tokenizer the run-time budget
        // logic uses (`container.tokenizer`), not a client-side heuristic.
        tokens: this.container.tokenizer.count(doc.body),
        used_by: usedBy.get(doc.path) ?? 0,
      });
    }

    return {
      files,
      index: {
        status: 'done',
        pct: 100,
        doc_count: files.length,
        refreshed_at: new Date().toISOString(),
      },
    };
  }

  /** (b) Re-walk the current clone and return the refreshed index status (AC-4). */
  async reindex(repoId: string): Promise<ContextIndexStatus> {
    const workspaceId = await this.repos.workspaceIdFor(repoId);
    if (!workspaceId) throw new NotFoundError('Repo not found');
    const listing = await this.listDocuments(workspaceId, repoId);
    return listing.index;
  }

  /**
   * (c) Ordered, deduped (first-occurrence-wins) path list to inject for an
   * agent run: the agent's own direct attachments in stored order, then each
   * ENABLED linked skill's attachments, per skill in `agent_skills.order`
   * ASC (AC-15). `linkedSkills` is already ordered ASC by that column
   * (`agents/repository.ts:192-200`), so iterating it in array order
   * preserves it.
   */
  async resolveForAgent(agentId: string): Promise<string[]> {
    const [directPaths, linkedSkills] = await Promise.all([
      this.contextDocs.listAgentPaths(agentId),
      this.container.agentsRepo.linkedSkills(agentId),
    ]);

    const ordered: string[] = [...directPaths];
    for (const link of linkedSkills) {
      // Enabled-only — same filter shape as the skill-body injection at
      // `run-executor.ts:252-253`.
      if (!link.skill.enabled) continue;
      const skillPaths = await this.contextDocs.listSkillPaths(link.skill.id);
      ordered.push(...skillPaths);
    }

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const path of ordered) {
      if (seen.has(path)) continue;
      seen.add(path);
      deduped.push(path);
    }
    return deduped;
  }

  /**
   * (d) Read every path fresh from `clonePath`, uncached (AC-12) — no
   * document-body caching layer exists anywhere in this service. Each path
   * is safety-checked with `safeRepoPath` + `isWithin` (see `readOne`); an
   * unreadable/out-of-root/oversized path is skipped with a reason, never
   * thrown (AC-14).
   */
  async readBodies(clonePath: string, paths: string[]): Promise<ReadBodiesResult> {
    const resolved: ReadBodiesResult['resolved'] = [];
    const skipped: ReadBodiesResult['skipped'] = [];
    if (paths.length === 0) return { resolved, skipped };

    let root: string;
    try {
      root = await realpath(clonePath);
    } catch {
      for (const path of paths) skipped.push({ path, reason: 'not_found' });
      return { resolved, skipped };
    }

    for (const rawPath of paths) {
      const doc = await this.readOne(root, rawPath);
      if (doc.ok) resolved.push({ path: doc.path, body: doc.body });
      else skipped.push({ path: rawPath, reason: doc.reason });
    }
    return { resolved, skipped };
  }

  // ---- write surface (T4, `docs/plans/project-context-authoring.md`) --------
  // Every method below resolves the repo via `resolveRepoClone` first, which
  // throws a structured `ValidationError` worded like `listDocuments`'s own
  // index-unavailable reasons (`:47-56` above) — never a bare-message
  // `Error` — when the repo has no clone or the clone is unreadable on disk
  // (AC-22). No git operation of any kind anywhere below (REQ-7).

  /**
   * (e) Read one document's full content fresh from the clone (AC-1, AC-4,
   * AC-24). Reuses `readOne`'s containment shape (`safeRepoPath` -> resolve
   * -> `isWithin` -> `realpath` -> `isWithin` again) to locate the file, then
   * hands the actual read off to T3's `readDocumentAt` (stat -> size check ->
   * read -> NUL check -> content-hash revision) instead of duplicating that
   * sequence a second time. Not restricted to the write root — a document
   * outside it is still readable, just reported `writable: false` (REQ-4).
   */
  async readDocument(workspaceId: string, repoId: string, path: string): Promise<ContextDocument> {
    const { root } = await this.resolveRepoClone(workspaceId, repoId);

    const safePath = safeRepoPath(path);
    if (!safePath) throw new NotFoundError('Document not found.');

    const requested = resolve(root, safePath);
    if (!isWithin(root, requested)) throw new NotFoundError('Document not found.');

    let actual: string;
    try {
      actual = await realpath(requested);
    } catch {
      throw new NotFoundError('Document not found.');
    }
    if (!isWithin(root, actual)) throw new NotFoundError('Document not found.');

    const folder = classifyFolder(safePath);
    if (!folder) throw new NotFoundError('Document not found.');

    const doc = await readDocumentAt(actual);
    if (!doc.ok) throw readAtError(doc.reason);

    const usedBy = await this.contextDocs.countAgentsByPath(workspaceId);

    return {
      path: safePath,
      content: doc.content,
      size: doc.size,
      updated_at: doc.mtime.toISOString(),
      source: FOLDER_TO_SOURCE[folder],
      tokens: this.container.tokenizer.count(doc.content),
      used_by: usedBy.get(safePath) ?? 0,
      revision: doc.revision,
      writable: isWritablePath(safePath),
    };
  }

  /**
   * (f) Save edited content to an existing, writable document (AC-6, AC-9,
   * AC-10, AC-11). Validates size, write-root membership and name *before*
   * touching disk, re-reads the on-disk copy, and rejects a stale
   * `expected_revision` with `ConflictError` — no force flag, no merge.
   */
  async saveDocument(
    workspaceId: string,
    repoId: string,
    input: SaveContextDocumentInput,
  ): Promise<SaveContextDocumentResult> {
    if (Buffer.byteLength(input.content) > MAX_FILE_SIZE) {
      throw new ValidationError(writeRejectMessage('too_large'));
    }

    const { root } = await this.resolveRepoClone(workspaceId, repoId);

    const safePath = safeRepoPath(input.path);
    if (!safePath || !isWritablePath(safePath)) {
      throw new ValidationError(writeRejectMessage('outside_write_root'));
    }
    // Safe: `isWritablePath` above already confirmed `safePath` is
    // `CONTEXT_WRITE_ROOT` or nested under it — `resolveWriteTarget` expects
    // its `relPath` argument relative to the write root, not the clone root.
    const relToWriteRoot = safePath.slice(CONTEXT_WRITE_ROOT.length + 1);

    const target = await resolveWriteTarget(root, relToWriteRoot, 'file');
    if (!target.ok) throw rejectionToError(target.reason);

    const onDisk = await readDocumentAt(target.abs);
    if (!onDisk.ok) throw readAtError(onDisk.reason);

    if (onDisk.revision !== input.expected_revision) {
      throw new ConflictError('Your copy is out of date. Reload the on-disk copy to continue.');
    }

    await writeAtomic(target.abs, input.content);
    const written = await stat(target.abs);

    return {
      path: safePath,
      size: written.size,
      updated_at: written.mtime.toISOString(),
      tokens: this.container.tokenizer.count(input.content),
      revision: revisionOf(input.content),
    };
  }

  /**
   * (g) Create a new, empty `.md` file or an empty folder under the write
   * root (AC-12, AC-13, AC-16). `input.path` is relative to the write root
   * (e.g. `api/public.md`), matching `resolveWriteTarget`'s own contract.
   */
  async createEntry(
    workspaceId: string,
    repoId: string,
    input: CreateContextEntryInput,
  ): Promise<CreateContextEntryResult> {
    const { root } = await this.resolveRepoClone(workspaceId, repoId);

    const writeRoot = await ensureWriteRoot(root);
    if (!writeRoot.ok) throw rejectionToError(writeRoot.reason);

    const target = await resolveWriteTarget(root, input.path, input.kind);
    if (!target.ok) throw rejectionToError(target.reason);

    const dirAbs = dirname(target.abs);
    const name = basename(target.abs);
    if (await findCollision(dirAbs, name)) {
      throw new ConflictError(writeRejectMessage('collision'));
    }

    try {
      if (input.kind === 'file') {
        await createNewFile(target.abs);
      } else {
        await createFolder(target.abs);
      }
    } catch (err) {
      // TOCTOU backstop: `findCollision` above is a readdir snapshot, so a
      // concurrent create between that check and this one is still caught by
      // `createNewFile`'s `wx` flag / plain `mkdir`'s own EEXIST.
      if (isEexist(err)) throw new ConflictError(writeRejectMessage('collision'));
      throw err;
    }

    const fullPath = `${CONTEXT_WRITE_ROOT}/${target.path}`;

    if (input.kind === 'folder') {
      return { kind: 'folder', path: fullPath, file: null };
    }

    const created = await readDocumentAt(target.abs);
    const file: SpecFile | null = created.ok
      ? this.newSpecFile(fullPath, created.content, created.size, created.mtime)
      : null;

    return { kind: 'file', path: fullPath, file };
  }

  /**
   * (h) Upload a `.md` document directly into the write root (AC-15, AC-16).
   * The stored name is *derived* by validating `input.filename` through the
   * same `resolveWriteTarget` pipeline as `createEntry` — the client string
   * never reaches the filesystem untrusted. Rejects a non-`.md`/oversized/
   * non-UTF-8 body and a name collision before writing.
   */
  async uploadDocument(
    workspaceId: string,
    repoId: string,
    input: UploadContextDocumentInput,
  ): Promise<CreateContextEntryResult> {
    if (input.bytes.byteLength > MAX_FILE_SIZE) {
      throw new ValidationError(writeRejectMessage('too_large'));
    }

    const content = input.bytes.toString('utf8');
    if (content.includes('\0')) {
      throw new ValidationError('Upload does not appear to be valid UTF-8 text.');
    }

    const { root } = await this.resolveRepoClone(workspaceId, repoId);

    const writeRoot = await ensureWriteRoot(root);
    if (!writeRoot.ok) throw rejectionToError(writeRoot.reason);

    const target = await resolveWriteTarget(root, input.filename, 'file');
    if (!target.ok) throw rejectionToError(target.reason);

    const dirAbs = dirname(target.abs);
    const name = basename(target.abs);
    if (await findCollision(dirAbs, name)) {
      throw new ConflictError(writeRejectMessage('collision'));
    }

    try {
      // `createNewFile`'s `wx` flag claims the name atomically (never
      // overwrites) before any content is written — the same TOCTOU
      // backstop `createEntry` relies on.
      await createNewFile(target.abs);
    } catch (err) {
      if (isEexist(err)) throw new ConflictError(writeRejectMessage('collision'));
      throw err;
    }
    await writeAtomic(target.abs, content);
    const written = await stat(target.abs);

    const fullPath = `${CONTEXT_WRITE_ROOT}/${target.path}`;
    const file = this.newSpecFile(fullPath, content, written.size, written.mtime);

    return { kind: 'file', path: fullPath, file };
  }

  /**
   * Build the `SpecFile` for a document this request itself just created
   * (create-file / upload) — no `used_by` yet (nothing can be attached to a
   * document that didn't exist a moment ago), source is always `specs`
   * because both callers only ever land inside `CONTEXT_WRITE_ROOT`.
   */
  private newSpecFile(path: string, content: string, size: number, mtime: Date): SpecFile {
    return {
      path,
      content,
      size,
      updated_at: mtime.toISOString(),
      source: FOLDER_TO_SOURCE.specs,
      tokens: this.container.tokenizer.count(content),
      used_by: 0,
    };
  }

  /**
   * Resolve `repoId` to its realpath'd clone root, or throw a structured,
   * worded `ValidationError`/`NotFoundError` — never a bare-message `Error`
   * — matching `listDocuments`'s own index-unavailable reasons (AC-22).
   */
  private async resolveRepoClone(workspaceId: string, repoId: string): Promise<{ root: string }> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    if (!repo.clonePath) {
      throw new ValidationError('Repository has not been cloned yet.');
    }
    try {
      return { root: await realpath(repo.clonePath) };
    } catch {
      throw new ValidationError('Repository clone is missing on disk. Re-index the repository.');
    }
  }

  // ---- pass-through to `ContextDocsRepository` (shared facade surface) ----
  // Exposed so consuming modules (agents service, skills service) go through
  // `container.contextDocs` for path list/set operations instead of each
  // constructing their own `ContextDocsRepository` instance.

  async listAgentPaths(agentId: string): Promise<string[]> {
    return this.contextDocs.listAgentPaths(agentId);
  }

  async setAgentPaths(agentId: string, paths: string[]): Promise<void> {
    return this.contextDocs.setAgentPaths(agentId, paths);
  }

  async listSkillPaths(skillId: string): Promise<string[]> {
    return this.contextDocs.listSkillPaths(skillId);
  }

  async setSkillPaths(skillId: string, paths: string[]): Promise<void> {
    return this.contextDocs.setSkillPaths(skillId, paths);
  }

  async countAgentsByPath(workspaceId: string): Promise<Map<string, number>> {
    return this.contextDocs.countAgentsByPath(workspaceId);
  }

  /**
   * Containment-checked single-file read shared by `listDocuments` (paths
   * already trusted — sourced from `walkClone`, which never follows
   * symlinks) and `readBodies` (paths are untrusted — persisted by a prior
   * `PUT .../context`). Every candidate is resolved with `resolve()` against
   * `root` and verified with `isWithin` both before and after `realpath`, so
   * a symlink cannot escape the repo root even if the literal path looked
   * safe — never a bare `join()`.
   */
  private async readOne(root: string, rawPath: string): Promise<ReadOneResult> {
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

    return { ok: true, path: safePath, body, size: fileStat.size, updatedAt: fileStat.mtime };
  }
}

type ReadOneResult =
  | { ok: true; path: string; body: string; size: number; updatedAt: Date }
  | { ok: false; reason: ContextDocSkipReason };

/**
 * The content folder a discovered path lives under, or `null` if it
 * qualifies for none. Matches a `specs`/`docs`/`insights` directory at ANY
 * depth in the tree — mirroring the assignment's own stated Reader glob,
 * `**\/{specs,docs,insights}/**\/*.md` (e.g. `server/docs/api.md`,
 * `client/insights/gotchas.md`), not just a repo-root-level folder.
 * `.devdigest/specs/` is the one explicitly-called-out instance of a nested
 * folder counting as `specs/` (AC-1); `.devdigest/docs` and
 * `.devdigest/insights` are NOT granted the same exception, so `.devdigest/`
 * is checked on its own terms before falling through to the general any-depth
 * scan below.
 */
function classifyFolder(relPath: string): (typeof CONTEXT_FOLDERS)[number] | null {
  const segments = relPath.split('/');
  if (segments.length < 2) return null; // no containing folder at all
  const [first, second] = segments;
  if (first === '.devdigest') return second === 'specs' ? 'specs' : null;
  // Directory segments only (the last segment is the file name itself);
  // first match wins, leftmost-first, matching how the glob would traverse.
  for (const segment of segments.slice(0, -1)) {
    if ((CONTEXT_FOLDERS as readonly string[]).includes(segment)) {
      return segment as (typeof CONTEXT_FOLDERS)[number];
    }
  }
  return null;
}

const FOLDER_TO_SOURCE: Record<(typeof CONTEXT_FOLDERS)[number], ContextSource> = {
  specs: 'spec',
  docs: 'docs',
  insights: 'insights',
};

function unavailableListing(reason: string): ContextListing {
  return {
    files: [],
    index: {
      status: 'error',
      pct: 0,
      message: reason,
      doc_count: 0,
      refreshed_at: null,
      unavailable_reason: reason,
    },
  };
}

/**
 * Map T3's `readDocumentAt` failure reason to a structured error (T4). Used
 * by both `readDocument` (initial read) and `saveDocument` (re-read for the
 * conflict check) so the two call sites word an oversized/unreadable
 * on-disk document identically.
 */
function readAtError(reason: ReadDocumentAtReason): AppError {
  switch (reason) {
    case 'not_found':
    case 'not_a_file':
      return new NotFoundError('Document not found.');
    case 'too_large':
      return new ValidationError('Document exceeds the maximum allowed size.');
    case 'unreadable':
      return new ValidationError('Document is not readable as text.');
  }
}

/**
 * Map a `WriteRejectReason` (T2's single source of wording, quoted via
 * `writeRejectMessage`) to the HTTP-shaped error T5's routes will surface.
 * `collision` is a `ConflictError` (409) — a distinguishable status the
 * client branches on (AC-16); every other reason is a `ValidationError`
 * (422) — malformed input, not a state conflict.
 */
function rejectionToError(reason: WriteRejectReason): AppError {
  if (reason === 'collision') return new ConflictError(writeRejectMessage(reason));
  return new ValidationError(writeRejectMessage(reason));
}

/** True iff `err` is a Node `fs` error with `code === 'EEXIST'`. */
function isEexist(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'EEXIST';
}
