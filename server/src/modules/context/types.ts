/**
 * context module — internal types (T7, `docs/plans/project-context.md`,
 * application ring; extended by T4,
 * `docs/plans/project-context-authoring.md`, with the four write methods).
 *
 * `ContextDocsFacade` is the interface `container.contextDocs` exposes and
 * `ContextDocsService` implements — mirrors the `RepoIntel` facade pattern
 * (`repo-intel/types.ts`) so Phase-3 consumers (T8 routes, T9 agents
 * service, T10 skills service, T11 run-executor) and tests code against an
 * interface, not the concrete class, and `ContainerOverrides.contextDocs`
 * can inject a mock without constructing a real `ContextDocsService`.
 */
import type {
  ContextDocument,
  ContextIndexStatus,
  ContextListing,
  CreateContextEntryResult,
  SaveContextDocumentResult,
} from '@devdigest/shared';

/**
 * Body for `saveDocument` — mirrors `SaveContextDocumentBody` field-for-field
 * but is spelled out locally (rather than imported) so the facade signature
 * doesn't force every consumer to import the contract type just to call it.
 */
export interface SaveContextDocumentInput {
  path: string;
  content: string;
  expected_revision: string;
}

/** Body for `createEntry` — mirrors `CreateContextEntryBody`. */
export interface CreateContextEntryInput {
  kind: 'file' | 'folder';
  path: string;
}

/**
 * Input for `uploadDocument` (T4, AC-15/AC-16). Not a `@devdigest/shared`
 * contract — the upload endpoint is multipart, not a JSON body, so `bytes`
 * is the raw file content T5's route reads off the multipart stream.
 * `filename` is the client-supplied name; it is untrusted and only ever used
 * as validation input — the stored name is *derived*, never trusted as-is
 * (upload-validation NFR).
 */
export interface UploadContextDocumentInput {
  filename: string;
  bytes: Buffer;
}

/** Why a fresh `readBodies` read was skipped instead of thrown (AC-14). */
export type ContextDocSkipReason =
  | 'unsafe_path'
  | 'outside_root'
  | 'not_found'
  | 'not_a_file'
  | 'too_large'
  | 'unreadable';

/** A path that resolved to a readable document body, read fresh (AC-12). */
export interface ResolvedContextDoc {
  /** Normalized repo-relative path (as returned by `safeRepoPath`). */
  path: string;
  body: string;
}

/** A path that could not be resolved/read — reported, never thrown (AC-14). */
export interface SkippedContextDoc {
  /** The raw stored path as passed in (may be malformed or stale). */
  path: string;
  reason: ContextDocSkipReason;
}

export interface ReadBodiesResult {
  /** Successfully read documents, in the same order as the input `paths`. */
  resolved: ResolvedContextDoc[];
  /** Entries that could not be resolved — reported, never thrown (AC-14). */
  skipped: SkippedContextDoc[];
}

/**
 * A path that resolved to filesystem metadata, without its body ever being
 * read (S-1, `docs/plans/pr-brief.md` T5a) — the PR Brief state key's
 * `mtimeMs + size` document-freshness component (S-3) is built from this.
 */
export interface StatBodiesResolvedDoc {
  /** Normalized repo-relative path (as returned by `safeRepoPath`). */
  path: string;
  mtimeMs: number;
  size: number;
}

export interface StatBodiesResult {
  /** Successfully stat'd documents — order is not significant to callers. */
  resolved: StatBodiesResolvedDoc[];
  /** Entries that could not be resolved — reported, never thrown, same
   *  reasons as `readBodies` (AC-14's shape, reused for consistency). */
  skipped: SkippedContextDoc[];
}

/**
 * The application-ring facade for Project Context. `server/src/platform/
 * container.ts` is the only file that both imports this interface and the
 * concrete `ContextDocsService` together (composition root).
 */
export interface ContextDocsFacade {
  /**
   * Discover every markdown document under a top-level `specs`/`docs`/
   * `insights` folder (`.devdigest/specs/` counts as an instance of
   * `specs/`) in the repo's current clone, with token estimates and
   * `used_by` counts (AC-1, AC-22). Returns an index-unavailable result
   * (files: [], `index.unavailable_reason` set) — never a thrown error and
   * never a silent empty list — when the repo has no clone or the clone is
   * unreadable on disk (AC-5).
   */
  listDocuments(workspaceId: string, repoId: string): Promise<ContextListing>;
  /** Re-walk the current clone and return the refreshed index status (AC-4). */
  reindex(repoId: string): Promise<ContextIndexStatus>;
  /**
   * Ordered, deduped (first-occurrence-wins) list of repo-relative paths to
   * inject for an agent run: the agent's own direct attachments in stored
   * order, then each of its ENABLED linked skills' attachments, per skill in
   * `agent_skills.order` ASC (AC-15).
   */
  resolveForAgent(agentId: string): Promise<string[]>;
  /**
   * Read every path fresh from `clonePath`, with no caching layer for
   * document bodies (AC-12). Every path is safety-checked with
   * `safeRepoPath` + `isWithin`; an unreadable/out-of-root/oversized path is
   * skipped and reported, never thrown (AC-14).
   */
  readBodies(clonePath: string, paths: string[]): Promise<ReadBodiesResult>;

  /**
   * Stat every path fresh from `clonePath` — no body ever read (S-1,
   * `docs/plans/pr-brief.md` T5a). Additive, read-only: it exists purely so
   * the PR Brief's state key can detect a document save/out-of-band edit via
   * `mtimeMs`/`size` without paying `readBodies`'s cost on the cheap `GET`
   * path (S-3). Reuses `readBodies`/`readOne`'s containment sequence
   * (`safeRepoPath` -> `resolve` -> `isWithin` -> `realpath` -> `isWithin`)
   * and the same skip reasons; an unreadable/out-of-root/oversized-for-stat
   * path is skipped and reported, never thrown.
   */
  statBodies(clonePath: string, paths: string[]): Promise<StatBodiesResult>;

  // ---- write surface (T4, `docs/plans/project-context-authoring.md`) --------
  // Every method below resolves the repo via `RepoRepository` and throws a
  // structured `NotFoundError`/`ValidationError` (never a bare-message
  // `Error`) worded like `listDocuments`' own index-unavailable reasons
  // (`service.ts:47-56`) when the repo has no clone or the clone is
  // unreadable on disk (AC-22) — the client is expected to have already
  // disabled these actions via the listing's `index.unavailable_reason`, so
  // reaching this case here means a direct/stale API call, not the normal
  // UI path. No git operation of any kind (REQ-7).

  /**
   * Read one document's full content fresh from the clone (AC-1, AC-4,
   * AC-24). `path` is the document's repo-relative path (the same shape
   * `SpecFile.path`/`ContextDocument.path` use elsewhere) — not restricted
   * to the write root; a document outside it is still readable, just
   * reported `writable: false`. Throws `NotFoundError` when the path isn't a
   * discovered Context document (unsafe, escapes the clone, or isn't under a
   * classified `specs`/`docs`/`insights` folder) and `ValidationError` when
   * it resolves but is oversized or unreadable as text.
   */
  readDocument(workspaceId: string, repoId: string, path: string): Promise<ContextDocument>;

  /**
   * Save edited content to an existing, already-writable document (AC-6,
   * AC-9, AC-10, AC-11). Validates write-root membership, name, and
   * `Buffer.byteLength(content) <= MAX_FILE_SIZE` (AC-20) before touching
   * disk; re-reads the on-disk copy and compares its revision against
   * `expected_revision`, throwing `ConflictError` on a mismatch (no
   * force/merge — the caller's one recovery action is to reload). Writes
   * atomically and returns the recomputed metadata.
   */
  saveDocument(
    workspaceId: string,
    repoId: string,
    input: SaveContextDocumentInput,
  ): Promise<SaveContextDocumentResult>;

  /**
   * Create a new, empty `.md` file or an empty folder under the write root
   * (AC-12, AC-13, AC-16). `input.path` is relative to the write root (e.g.
   * `api/public.md`), matching `write-fs.ts#resolveWriteTarget`'s own
   * contract. A case-insensitive name collision throws `ConflictError`
   * (never overwritten, never auto-renamed).
   */
  createEntry(
    workspaceId: string,
    repoId: string,
    input: CreateContextEntryInput,
  ): Promise<CreateContextEntryResult>;

  /**
   * Upload a `.md` document directly into the write root (AC-15, AC-16). The
   * stored name is *derived* from validating `input.filename`, never trusted
   * as the client sent it. Rejects a non-`.md` extension, an oversized body,
   * non-UTF-8/binary content, and a name collision (`ConflictError`).
   */
  uploadDocument(
    workspaceId: string,
    repoId: string,
    input: UploadContextDocumentInput,
  ): Promise<CreateContextEntryResult>;

  /**
   * Pass-through to T4's `ContextDocsRepository` — exposed on the facade so
   * consuming modules (T9 agents service, T10 skills service) share the one
   * `ContextDocsRepository` instance owned by `ContextDocsService`, instead
   * of each constructing their own. Paths attached to an agent, ordered by
   * `"order"` ASC (AC-8).
   */
  listAgentPaths(agentId: string): Promise<string[]>;
  /**
   * Replace the full set of attached paths for an agent with `paths`, in one
   * transaction: delete-all then re-insert with `order` = array index.
   */
  setAgentPaths(agentId: string, paths: string[]): Promise<void>;
  /** Paths attached to a skill, ordered by `"order"` ASC (AC-8). */
  listSkillPaths(skillId: string): Promise<string[]>;
  /**
   * Replace the full set of attached paths for a skill with `paths`, in one
   * transaction: delete-all then re-insert with `order` = array index.
   */
  setSkillPaths(skillId: string, paths: string[]): Promise<void>;
  /**
   * How many agents in `workspaceId` have each path directly attached, as a
   * `path -> count` map (AC-1).
   */
  countAgentsByPath(workspaceId: string): Promise<Map<string, number>>;
}
