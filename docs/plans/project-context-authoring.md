# Development Plan: Project Context — document authoring (preview, edit, create, upload)

Source spec: [`specs/2026-08-27-project-context-authoring.md`](../../specs/2026-08-27-project-context-authoring.md)
(SPEC-2026-08-27-project-context-authoring, status `approved`, 29 acceptance
criteria, no open questions).

Builds on the shipped feature planned in
[`docs/plans/project-context.md`](project-context.md)
(SPEC-2026-08-26-project-context) — that plan is fully executed; this one picks
up the authoring UI it deferred (`docs/plans/project-context.md:400-402`).

## Context

Project Context today is read-only and metadata-only: the listing endpoint
deliberately sets `content: null` for every document
(`server/src/modules/context/service.ts:80`) and the `/context` page renders a
single-pane list (`client/src/app/context/_components/ContextView/ContextView.tsx:95-101`),
so a user cannot read — let alone write — a grounding document inside DevDigest.
This plan implements the approved spec: a two-pane master-detail `/context`
screen (list + Preview/Edit detail pane) and the four **write** endpoints behind
it (save, create file, create folder, upload), all confined to `.devdigest/specs/`.

The sharpest change is that the server starts **writing into the git clone**.
Today the only filesystem write anywhere in `server/src` is the local secrets
file (`server/src/adapters/secrets/local.ts:47-48`), and the existing
`safeRepoPath`/`isWithin` containment work (`server/src/modules/_shared/path-safety.ts:9-21`)
was designed for reads. Every task below that touches the filesystem treats
that as the security-critical part of the work.

## Requirements (as reviewed)

Restated from the approved spec — **not authored here**. Goals G-1…G-5 and
AC-1…AC-29 are referenced by ID; the spec carries the full EARS text.

- **REQ-1 (G-1 / AC-1…AC-4):** Read a selected document's real content, fresh
  from the clone, in a detail pane rendered as markdown, with its repo-relative
  path and "used by N agents"; the flat repo-wide list stays visible with the
  selected row marked; nothing is auto-selected on first load (placeholder
  instead); an unreadable/missing/oversized/uncontained document shows a
  named error without breaking the page.
- **REQ-2 (G-2 / AC-5…AC-11):** Edit raw markdown in a plain textarea seeded
  from disk, with Preview/Edit as a two-state toggle; **Save writes
  immediately** (no confirm step, no autosave) and reports success or a stated
  failure; unsaved state is shown as text with a **Discard**; leaving a dirty
  editor requires confirmation; a stale copy is **rejected** with exactly one
  recovery action ("reload the on-disk copy") and no force/merge; a successful
  save refreshes that document's metadata and the status line without a page
  reload; the write is **atomic**.
- **REQ-3 (G-3 / AC-12…AC-16):** **New file** asks for a name, creates an empty
  `.md` under the write root, lists it and opens it in Edit mode; **New folder**
  asks for a name and creates it, telling the user an empty folder will not
  appear in the list; **Upload** (toolbar file-picker only) accepts a `.md`
  passing name and size rules straight into `.devdigest/specs/`; a
  **case-insensitive** name collision is rejected — never overwritten, never
  auto-renamed.
- **REQ-4 (G-4 / AC-17…AC-24):** A write is accepted only when the resolved
  target is inside the clone root **and** under `.devdigest/specs/` (created if
  absent), via `safeRepoPath`/`isWithin`, never a bare `join()`; names are
  validated per segment (`A-Z a-z 0-9 . _ -`, ≤100 chars, no absolute/`..`/
  leading dot/control chars, files end `.md`); a target resolving through a
  **symlink** is rejected; a body or upload over `MAX_FILE_SIZE` (400 KB,
  `server/src/modules/context/constants.ts:13`) is rejected before any write;
  the multipart cap applied to a context upload equals `MAX_FILE_SIZE` **without
  loosening skill import's 256 KB cap** (`server/src/app.ts:103`); with no clone
  on disk every authoring action is disabled with the reason shown; every
  authoring request is workspace/repo scoped via `getContext(container, req)`;
  a document outside the write root is **preview-only** with Edit visibly
  unavailable and a stated reason.
- **REQ-5 (G-5 / AC-25…AC-29):** The status line states documents indexed,
  combined token estimate and last refresh — all from the listing the server
  returned — and no "chunks" figure; any metric DevDigest does not compute is
  **omitted**, specifically `chunks_indexed` (`ContextView.tsx:50-52`); the
  **COVERAGE badge is omitted entirely** from header and rows; the editor always
  states that saves live only in the local clone, are not committed/pushed, and
  can be lost on re-index; **Re-index requires an explicit confirmation** naming
  that consequence whenever the session holds unsaved edits or has written any
  document since the last refresh.
- **REQ-6 (NFRs):** write containment (traversal/absolute/backslash/symlink/
  other-`docs`-folder/case-fold each rejected with nothing written); untrusted
  markdown rendered as data (no script, no raw HTML handlers, no `javascript:`
  URLs); upload validated **server-side** on extension/name/size with a
  server-derived stored name; atomic writes; bodies fetched only for the
  selected document, never in the list; keyboard-only operability with
  accessible names on the four icon buttons and text (not colour) state; every
  write attempt logged with action + path + outcome and **no document content
  in any log line**.
- **REQ-7 (Non-goals — explicitly excluded):** COVERAGE badge/score; rename,
  move, delete; **any git operation** (no commit, push, branch, PR, diff or
  conflict resolution); a folder-tree left pane; autosave/draft recovery/undo
  history; merge or diff UI on conflict; drag-and-drop upload; non-markdown
  files; changes to attach/detach, token budgets, run-time injection or Run
  Trace; multi-user concurrent editing.

## Recommendations

Advice for you to accept or reject. Items 1-4 are already reflected in the task
table because an AC or NFR effectively forces the choice; say the word and I'll
rework any of them.

1. **Satisfy AC-21 with a per-request multipart limit, not by editing
   `app.ts:103`.** `@fastify/multipart` 9.4.0 types `request.file(options)` with
   per-request `limits` (`server/node_modules/@fastify/multipart/types/index.d.ts:18-19`),
   so the context upload route calls
   `req.file({ limits: { fileSize: MAX_FILE_SIZE, files: 1 } })` while the
   global registration stays at 256 KB for skill import
   (`server/src/modules/skills/routes.ts:218`, the *only* other multipart
   consumer — verified by grep). This satisfies AC-21's substance ("the
   multipart transport cap **applied to a context-document upload** shall equal
   `MAX_FILE_SIZE` … shall not raise the skill-import cap") while keeping
   `app.ts` out of this plan entirely and making the second clause true *by
   construction* rather than by a second constant. The app-level
   `bodyLimit: 1_048_576` (`app.ts:50`) already accommodates a 400 KB JSON save
   body, so it needs no change either.
2. **Make `revision` a SHA-256 of the on-disk content, not `mtime`+`size`.**
   AC-9 is the whole conflict story and mtime has millisecond granularity: two
   saves in the same millisecond producing the same byte count would yield an
   identical token and silently defeat stale detection. Hashing ≤400 KB is
   cheap and the file is being read anyway.
3. **Report the save outcome as an inline `role="status"` line in the detail
   pane, not a toast.** This repo has **no toast system** (no `Toast`/`useToast`
   anywhere in `client/src/vendor/ui` or `client/src/components`), and both
   AC-6 ("never leaving the user guessing") and the accessibility NFR ("conveyed
   as text") are better served by a queryable live region than by a new global
   notification mechanism this spec did not ask for.
4. **Keep one facade — put the write methods on the existing
   `ContextDocsService`, delegating to two new hermetic modules.** The security
   logic lands in `write-safety.ts` (pure: name + containment rules) and
   `write-fs.ts` (filesystem only, root injected), both unit-testable **without
   Postgres and without a `Container`**; `service.ts` keeps the DB/tokenizer
   coordination. Consequence: `server/src/platform/container.ts` is **not
   touched by this plan at all** (the `contextDocs` facade already exists,
   `container.ts:153-156`), and there is no second facade to wire.
5. **Show AC-14's empty-folder note as inline text after creation, not a second
   dialog.** The user has just dismissed a name prompt; a second modal to say
   "this won't appear yet" is worse UX than a line under the toolbar.
6. **`e2e/` coverage is a follow-up.** `e2e/` is out of scope for `implementer`;
   an `agent-browser` flow for select → edit → save → conflict should be
   authored by hand after this plan lands.
7. **Docs are a follow-up for `doc-writer`.** `server/README.md` has no endpoint
   list for the context module today (`grep -n "context" server/README.md`
   returns only the unrelated "Review context" section), so nothing in this plan
   is obliged to update it — but four new write endpoints are worth documenting
   once they exist.

### Spec citations that have drifted (verified against current code)

Not errors in the spec — trust the code over the line numbers:

- Spec cites `repo-intel/pipeline/walk.ts:89` for the never-follow-symlinks
  property (AC-19). It is now at **`walk.ts:112`** (`if (entry.isSymbolicLink()) continue;`)
  — the file was parameterised by the previous plan's T3, shifting the lines.
- Spec cites `context/service.ts:212-218` for the post-`realpath` containment
  re-check. The full guarded read is **`service.ts:205-233`** (`readOne`), with
  the post-`realpath` check at `:218`.
- Everything else load-bearing was verified accurate: `app.ts:103`
  (`fileSize: 256 * 1024, files: 1`), `context/constants.ts:13`
  (`MAX_FILE_SIZE` = `repo-intel/constants.ts:43` = 400 KB), `path-safety.ts:9-21`,
  `service.ts:47-56` (unavailable), `:58-61` (markdown walk), `:75-88`
  (`content: null`), `:246-255` (`classifyFolder`), `platform.ts:262-273`
  (`SpecFile`), `context.json:15-23` (unused `mode.*`/`editor.*` keys),
  `skills/routes.ts:218` (`req.file()`).
- **The context module has no tests at all today** — `ls server/test | grep -i context`
  is empty; the previous plan's T17-T19 test files were never created. T6/T7
  below are therefore this module's first server-side tests, not additions.

## Execution Mode

**Single-agent (one sequential `implementer` pass, task by task in ID order).**
This is my recommendation, not a close call, so I'm proceeding with it — you run
it with `/implement-plan` exactly as you did for `docs/plans/project-context.md`.

Why single-agent here, when the previous plan was multi-agent:

- The security-critical surface is **concentrated**: `write-safety.ts` →
  `write-fs.ts` → `service.ts` → `routes.ts` is a straight chain where each
  layer consumes the one before it. Splitting it across parallel agents buys
  no wall-clock time (they'd each wait on the previous link) and costs
  correctness reviewability on exactly the code that must not be got wrong.
- The client half is **one screen**: the list pane, the toolbar, the detail
  pane and the dirty/conflict state are a single interaction model. Parallel
  agents would have to agree on an invented prop contract before either could
  verify anything.

That said, the DAG below **is** parallel-safe if you change your mind — owned
paths are disjoint everywhere they need to be. The parallel-safe pairs are:
**T2 ‖ T8**, **T6 ‖ T7** (after T5), **T10 ‖ T11** (after T9), **T12 ‖ T13**.
Nothing else may run concurrently.

## Affected Modules & Contracts

- **server** (`@devdigest/api`) — the existing `modules/context/` module gains
  two new files and four new endpoints; one new error class in
  `platform/errors.ts`. **`server/src/app.ts` is NOT touched** (Recommendation 1).
  **`server/src/platform/container.ts` is NOT touched** (Recommendation 4).
  No database change: nothing this feature writes is persisted in Postgres.
- **client** (`@devdigest/web`) — `src/app/context/**` rebuilt into master-detail;
  four hooks added to `src/lib/hooks/core.ts`; `messages/en/context.json`
  extended. **`client/src/vendor/ui/` is NOT touched** — the nav entry already
  exists from the previous plan.
- **reviewer-core** — **untouched**. Nothing here goes near the prompt, the
  `LLMProvider`, or `groundFindings()`.
- **mcp-server** — untouched (run its suite once as a regression guard).
- **e2e** — out of scope (Recommendation 6).

**Contract changes in `@devdigest/shared` (vendored, both mirrors):**

| File | Change | Mirrors |
|---|---|---|
| `contracts/platform.ts` | **Additive only.** New `ContextDocument`, `SaveContextDocumentBody`, `SaveContextDocumentResult`, `CreateContextEntryBody`, `CreateContextEntryResult`. **No existing schema is modified** — `SpecFile`, `ContextListing`, `ContextIndexStatus` stay byte-identical, which is what keeps the list response body-free (AC + previous spec's "list without bodies" NFR) | **both** mirrors, byte-identical, **one task (T1)** |
| everything else | none | — |

Deliberately **not** added: a `write_root` field on `ContextListing`. The write
root appears only in user-facing copy (`.devdigest/specs/` is already named in
`context.json`'s `empty.body`); per-document `writable` is what the UI actually
branches on (AC-24). Zero edits to existing contracts = zero fixture blast
radius (`client/INSIGHTS.md`, 2026-08-04, `.nullable()` vs `.nullish()`).

## Architecture Notes

**Onion layers touched** (`.claude/skills/onion-architecture/LAYER_MAP.md:37`
already classifies `context` as a full split):

- *Presentation* — `modules/context/routes.ts` (4 new endpoints; Zod at the
  boundary; tenancy via `getContext`; no fs, no SQL, no business rules).
- *Application* — `modules/context/service.ts` (+ `types.ts` facade): resolves
  the repo/clone via `RepoRepository`, orchestrates validation → filesystem →
  tokenizer → response shape.
- *Infrastructure-ish, module-local* — `modules/context/write-fs.ts`
  (filesystem effects only, absolute root injected as an argument — no
  `Container`, no DB) and `modules/context/write-safety.ts` (pure functions, no
  I/O at all). Both are deliberately callable from a test with a `mkdtemp`
  directory, which is what makes the whole NFR security matrix a **fast-lane**
  test instead of a `.it.test.ts`.
- *Domain* — untouched.

**Do-not-touch items in play:**

- `server/src/vendor/shared/` + `client/src/vendor/shared/` — "never hand-edit
  without coordination" (`server/AGENTS.md:13`, `client/AGENTS.md:13`).
  **Exactly one task (T1) may edit these trees**, and its acceptance includes a
  `diff` proving the two `platform.ts` copies stay byte-identical.
- `client/src/vendor/ui/` — "vendored/mirrored; edit deliberately"
  (`client/AGENTS.md:13`). **No task in this plan edits it.** The `/context` nav
  entry already landed with the previous plan.
- `server/src/db/migrations/` — irrelevant here: this feature adds no table,
  column or migration.
- `reviewer-core/src/grounding.ts` — untouched.

**Security invariant (REQ-4, NFR "write containment") — the core of this plan:**
every write target is derived as
`safeRepoPath(raw)` → `resolve(cloneRoot, rel)` → `isWithin(cloneRoot, abs)` →
**`isWithin(writeRoot, abs)`** → `realpath` of the *existing* ancestor chain →
`isWithin` again, and only then a filesystem call. The extra write-root check is
what makes this stricter than the existing read path (`service.ts:205-233`),
which only requires "inside the clone". A bare `join()` is forbidden, and
`repo-intel/service.ts:923-925`'s unguarded `readFile(join(clonePath, file))`
must not be copied or called by any task here.

**Relevant INSIGHTS entries:**

- `client/INSIGHTS.md` 2026-08-04 — "A zod `.nullable()` field is REQUIRED …
  `.nullish()` is what makes it optional." Drives T1's decision to add only new
  schemas and modify none.
- `client/INSIGHTS.md` 2026-08-04 — formatters used by >1 tree belong in
  `client/src/lib/format.ts`. Relevant to T11's status-line formatting: reuse
  `lib/format.ts` / the existing `ContextView/helpers.ts:formatRefreshedAt`
  rather than writing a third copy.
- `client/INSIGHTS.md` 2026-08-11 — `extensionAlias` in `next.config.mjs` is
  what makes `.js`-suffixed vendor imports resolve; if a new import of a
  contract "cannot be found", suspect that before a stale cache.
- `server/INSIGHTS.md` 2026-08-06 — check for an existing helper before
  hand-rolling one. Here: `safeRepoPath`/`isWithin` and `readOne`'s
  containment shape already exist; extend that pattern, don't invent a second.

**Known-good primitives to reuse (don't rebuild):**
`client/src/components/ConfirmDialog.tsx` (AC-8, AC-29), `@devdigest/ui`'s
`Markdown` primitive (`client/src/vendor/ui/primitives/Markdown.tsx` —
`react-markdown` ^9.0.3 with **no** `rehype-raw`, so raw HTML is dropped and
`javascript:` URLs are stripped by the default `urlTransform`; this is what
makes the untrusted-rendering NFR pass, and T10 must **not** add `rehype-raw`),
`Textarea` (`client/src/vendor/ui/kit/Textarea.tsx`), and `api.upload(path, formData)`
(`client/src/lib/api.ts:80`, already FormData-aware).

## Phases

Dependency graph (acyclic):
T1 → T4 → T5 → {T6, T7}; T2 → T3 → T4; T1 → T8 → T9 → {T10, T11};
T10 → T13; T11 → T12.

### Phase 0: Contracts (1 task)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T1 | server + client | contracts | `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts` | — | zod, typescript-expert | **The one coordinated vendor edit.** Add, next to the existing Project Context block (`platform.ts:257-301`), **new schemas only — modify none**: `ContextDocument = { path, content: z.string(), size: z.number().int(), updated_at: z.string(), source: ContextSource, tokens: z.number().int(), used_by: z.number().int(), revision: z.string(), writable: z.boolean() }` (AC-1, AC-9, AC-24); `SaveContextDocumentBody = { path: z.string(), content: z.string(), expected_revision: z.string() }`; `SaveContextDocumentResult = { path, size, updated_at, tokens, revision }`; `CreateContextEntryBody = { kind: z.enum(['file','folder']), path: z.string() }`; `CreateContextEntryResult = { kind: z.enum(['file','folder']), path: z.string(), file: SpecFile.nullish() }` (a folder has no `SpecFile` — AC-13/AC-14). Export the inferred type beside each schema, matching the file's existing style. Verify: `diff server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts` prints nothing; `cd server && pnpm exec vitest run test/contracts.test.ts && pnpm typecheck`; `cd client && pnpm typecheck` |

### Phase 1: Server write primitives (2 tasks — T2 then T3)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T2 | server | backend | `server/src/modules/context/write-safety.ts` (new), `server/src/modules/context/constants.ts` | — | security, typescript-expert, onion-architecture | **Pure functions, zero I/O** (no `fs`, no `Container`, no DB) — the AC-18/AC-24 rulebook. In `constants.ts` add `CONTEXT_WRITE_ROOT = '.devdigest/specs'`, `NAME_SEGMENT_MAX = 100`, `NAME_SEGMENT_RE = /^[A-Za-z0-9._-]+$/` (document that `MAX_FILE_SIZE` at `:13` is reused unchanged for AC-20). In `write-safety.ts` export: (a) `validateEntryPath(raw: string, kind: 'file'\|'folder'): { ok: true; path: string } \| { ok: false; reason: WriteRejectReason }` — **build on `safeRepoPath`** (`_shared/path-safety.ts:15-21`, which already rejects absolute, backslash, `..`, `.` and empty segments) and then additionally reject a leading dot on any segment, any control character incl. `\0`, any segment failing `NAME_SEGMENT_RE` or longer than `NAME_SEGMENT_MAX`, and — for `kind: 'file'` — a name not ending in `.md` (AC-18, multi-segment relative paths like `api/public.md` allowed, each segment validated identically per AC-17); (b) `isWritablePath(repoRelPath: string): boolean` — true iff the path is under `CONTEXT_WRITE_ROOT` (AC-24, drives `ContextDocument.writable`); (c) `revisionOf(content: string): string` — `createHash('sha256').update(content).digest('hex')` (Recommendation 2); (d) an exported `WriteRejectReason` union with a human message per reason, so routes and logs quote one source. Verify: `cd server && pnpm typecheck` green; `grep -n "node:fs\|readFile\|writeFile" server/src/modules/context/write-safety.ts` returns nothing |
| T3 | server | backend | `server/src/modules/context/write-fs.ts` (new) | T2 | security, typescript-expert, onion-architecture | **Filesystem effects only; the clone root is an argument, never resolved here** (no DB, no `Container`) so every function is testable against a `mkdtemp` directory. Export: (a) `resolveWriteTarget(cloneRoot, relPath, kind)` → absolute path or a `WriteRejectReason` — runs T2's `validateEntryPath`, then `resolve(cloneRoot, rel)`, `isWithin(cloneRoot, abs)`, `isWithin(join(cloneRoot, CONTEXT_WRITE_ROOT), abs)`, then `realpath`s the deepest **existing** ancestor and re-checks `isWithin` on the result, so a symlinked `.devdigest`, `.devdigest/specs` or intermediate folder is rejected (AC-17, AC-19). **Never a bare `join()` for the target**; never follow a symlink. (b) `ensureWriteRoot(cloneRoot)` — `mkdir(..., { recursive: true })` then `realpath` + `isWithin` re-verify (AC-17, "created if it does not exist yet"). (c) `findCollision(dirAbs, name)` — `readdir` compared with `localeCompare(..., { sensitivity: 'accent' })` or lowercased equality, so `Spec.md` collides with `spec.md` on any filesystem (AC-16). (d) `writeAtomic(targetAbs, content)` — write to `<dir>/.<basename>.<random>.tmp` **in the same directory** then `rename()`, `unlink`ing the temp file in a `finally`/`catch` so a failure never leaves a partial document (AC-11); the temp suffix is not `.md`, so discovery (`walkClone` with `MARKDOWN_EXT`) never lists it. (e) `createNewFile(targetAbs)` — `writeFile(target, '', { flag: 'wx' })` so an existing file is never truncated (AC-16 belt-and-braces alongside `findCollision`); `createFolder(targetAbs)`. (f) `readDocumentAt(absPath)` → `{ content, size, mtime, revision }` or a reason, reusing the `stat` → `MAX_FILE_SIZE` → `readFile` → NUL-check sequence already in `service.ts:220-232` (AC-4, AC-20). Verify: `cd server && pnpm typecheck` green; `grep -n "join(" server/src/modules/context/write-fs.ts` shows no un-contained path join (temp-file naming inside an already-validated directory is the only permitted `join`, and must be commented as such) |

### Phase 2: Server application ring (1 task)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T4 | server | backend | `server/src/modules/context/service.ts`, `server/src/modules/context/types.ts`, `server/src/platform/errors.ts` | T1, T3 | onion-architecture, security, typescript-expert | Extend `ContextDocsFacade` + `ContextDocsService` with four methods, each resolving the repo via the existing `RepoRepository` and returning an **index-unavailable-style stated failure** (never a throw with a bare message) when `repo.clonePath` is missing or unreadable — the same shape `listDocuments` already produces at `service.ts:47-56` (AC-22). (a) `readDocument(workspaceId, repoId, path)` → `ContextDocument`: containment-checked read via T3's `readDocumentAt` + the existing `readOne` guarantees, `tokens` from `this.container.tokenizer.count(content)`, `used_by` from `this.contextDocs.countAgentsByPath`, `revision` from T2's `revisionOf`, `writable` from T2's `isWritablePath` (AC-1, AC-4, AC-24). (b) `saveDocument(workspaceId, repoId, { path, content, expected_revision })`: validate write root + name + `Buffer.byteLength(content) <= MAX_FILE_SIZE` (AC-20) **before touching disk**, re-read the on-disk content, compare `revisionOf(onDisk)` against `expected_revision` and on mismatch throw the new `ConflictError` (AC-9 — no force flag, no merge), otherwise `writeAtomic` and return `SaveContextDocumentResult` with recomputed size/tokens/revision (AC-6, AC-10, AC-11). (c) `createEntry(workspaceId, repoId, { kind, path })`: `ensureWriteRoot` → `resolveWriteTarget` → `findCollision` → `createNewFile` (empty) or `createFolder`; returns `CreateContextEntryResult` (AC-12, AC-13, AC-16). (d) `uploadDocument(workspaceId, repoId, { filename, bytes })`: **derive** the stored name from validation rather than trusting the client string, enforce `.md` + size, land it directly in `CONTEXT_WRITE_ROOT`, reject a collision (AC-15, AC-16, upload-validation NFR). Add `ConflictError` to `platform/errors.ts` (`super('conflict', message, 409, details)`) alongside `NotFoundError`/`ValidationError`, following that file's existing shape. **No git operation of any kind** anywhere in this task (REQ-7). Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` green; `grep -rn "simpleGit\|git \|commit\|push" server/src/modules/context/service.ts` shows no git usage |

### Phase 3: Server presentation (1 task)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T5 | server | backend | `server/src/modules/context/routes.ts`, `.claude/skills/onion-architecture/LAYER_MAP.md` | T4 | fastify-best-practices, zod, security, onion-architecture | Four endpoints on the existing plugin, each thin (Zod at the boundary, `getContext(container, req)` for tenancy per AC-23, one call into `container.contextDocs`, no fs and no rules here): `GET /repos/:id/context/document` with a `?path=` querystring → `ContextDocument` (AC-1); `PUT /repos/:id/context/document` body `SaveContextDocumentBody` → `SaveContextDocumentResult`, `ConflictError` surfacing as **409** with a distinguishable `code` the client can branch on (AC-6, AC-9); `POST /repos/:id/context/entries` body `CreateContextEntryBody` → `CreateContextEntryResult` (AC-12, AC-13); `POST /repos/:id/context/upload` reading `await req.file({ limits: { fileSize: MAX_FILE_SIZE, files: 1 } })` — **the per-request cap, `server/src/app.ts` stays untouched** (AC-21, Recommendation 1) — validating extension/name/size server-side regardless of any client filter, then `uploadDocument`. **NFR observability:** one `req.log.info`/`warn` per write attempt carrying `{ action, path, outcome }` (and the rejection reason when rejected) and **never the document body** — assert that by construction, the log call must not receive `content`. Update the `context` row in `LAYER_MAP.md:37` to name `write-safety.ts` / `write-fs.ts`. Verify: `cd server && pnpm exec vitest run test/routes-smoke.test.ts --exclude '**/*.it.test.ts' && pnpm typecheck` green; `git diff --stat server/src/app.ts` is empty |

### Phase 4: Server verification (2 tasks — parallel-safe with each other)

Assign these to the `test-writer` agent. Both are **fast-lane** (`*.test.ts`,
no Postgres): T6 uses `mkdtemp` directories, T7 uses `buildApp` + `MockAuthProvider`
+ a `contextDocs` override, following `server/test/routes-smoke.test.ts:1-20`.

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T6 | server | test | `server/test/context-write-safety.test.ts` (new) | T5 | security, typescript-expert, react-testing-library *(vitest patterns only)* | **The NFR "write containment" matrix, one assertion per row, each asserting nothing was written to disk** (`readdir` the temp clone afterwards): `../../../../etc/passwd`, `/etc/passwd`, `..\\..\\x.md`, a path whose parent is a **symlinked** directory pointing outside the clone (AC-19), a target inside another discovered folder such as `docs/x.md` or `server/insights/y.md` (AC-17 — read scope is repo-wide, write scope is not), a name with a control character/`\0`, a 101-character segment, a `.txt` name, a leading-dot name (AC-18). Plus: **AC-16** — creating `Spec.md` when `spec.md` exists is rejected with a collision reason and the existing file is byte-unchanged; **AC-20** — a 401 KB body is rejected before any write; **AC-11** — after `writeAtomic` on an existing document the target holds either the full old or the full new content and **no `*.tmp` file remains in the directory**; **AC-24** — `isWritablePath` is true for `.devdigest/specs/a.md` and false for `docs/a.md`. Verify: `cd server && pnpm exec vitest run test/context-write-safety.test.ts && pnpm typecheck` green |
| T7 | server | test | `server/test/context-write-routes.test.ts` (new) | T5 | fastify-best-practices, security | HTTP-boundary lane via `app.inject()`. **AC-21 is the headline and needs both halves:** a ~300 KB `.md` multipart upload to `POST /repos/:id/context/upload` is **accepted** (proving the per-request cap is 400 KB, not 256 KB), and a >256 KB upload to `POST /skills/import/file` is **still rejected** (proving the global cap was not loosened). Plus the upload-validation NFR: a `.txt` upload rejected, a >400 KB upload rejected, a traversal filename rejected — each with **no file created** (assert via the `contextDocs` mock never being called with a write, or an empty temp dir); a 409 body from a stale `expected_revision` carries a distinguishable error code (AC-9); every write route is workspace-scoped through `getContext` (AC-23). Verify: `cd server && pnpm exec vitest run test/context-write-routes.test.ts && pnpm typecheck` green |

### Phase 5: Client data layer (1 task)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T8 | client | ui | `client/src/lib/hooks/core.ts`, `client/messages/en/context.json` | T1 | react-best-practices, next-best-practices, typescript-expert | Four hooks next to the existing `useContextFiles`/`useReindexContext` (`core.ts:143-160`), same TanStack Query style: `useContextDocument(repoId, path)` (`queryKey: ["context-doc", repoId, path]`, `enabled` only when both are set — **AC-3, never auto-fetch with no selection**, and the "bodies on demand only" NFR); `useSaveContextDocument`, `useCreateContextEntry`, `useUploadContextDocument` (via `api.upload`, `lib/api.ts:80`). Every mutation's `onSuccess` invalidates **both** `["context", repoId]` (status line + list, AC-10) and the affected `["context-doc", …]`. Extend `messages/en/context.json` — **keep `empty.*` verbatim** (quoted by the previous spec's AC-2) and **reuse the already-present `mode.preview`/`mode.edit`/`editor.save`/`editor.saving`/`editor.loadError` keys** (`context.json:15-23`) rather than adding parallel ones; add `toolbar.*` (four accessible names: new file, new folder, upload, refresh — accessibility NFR), `detail.*` (placeholder, path, usedBy, readOnlyReason for AC-24), `editor.discard`/`unsaved`/`saved`/`saveFailed`/`localOnlyWarning` (AC-28), `conflict.*` (message + the single "reload the on-disk copy" action, AC-9), `create.*` (name prompt, collision, invalid-name), `upload.*`, `folderInvisibleNote` (AC-14), `status.*` (documents + tokens + refreshed, AC-25), `reindexConfirm.*` (AC-29), `unsavedConfirm.*` (AC-8). `en` is the only locale present. Verify: `cd client && pnpm test && pnpm typecheck` green |

### Phase 6: Client UI rebuild (3 tasks — T9, then T10 ‖ T11)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T9 | client | ui | `client/src/app/context/_components/ContextView/useContextAuthoring.ts` (new), `client/src/app/context/_components/ContextView/types.ts` (new) | T8 | react-best-practices, react-frontend-architecture, typescript-expert | **The state machine, extracted as a hook before any JSX exists** (react-frontend-architecture: "thin component + custom hook"; react-best-practices: business logic out of component bodies) — this is what keeps T10/T11 presentational and independently testable. Owns: `selectedPath` (**null on first load — no auto-select, AC-3**), `mode: 'preview' \| 'edit'` (AC-5), `draft` + `isDirty` derived by comparing draft to the loaded content (**derive, don't store** — no `useState` mirror of a computed value), `conflict` state and its single `reloadFromDisk()` recovery (AC-9), `pendingAction` for the confirm-before-discard gate on select/preview/navigate (AC-8), `hasWrittenThisSession` (set by any successful save/create/upload, cleared on a successful re-index) which together with `isDirty` arms the Re-index confirmation (AC-29), and the save/create/upload callbacks wrapping T8's mutations with their outcome message (AC-6). No JSX in this file; export the prop types T10 consumes from `types.ts`. Verify: `cd client && pnpm typecheck` green; `grep -n "useEffect" useContextAuthoring.ts` shows no effect used for derived state |
| T10 | client | ui | `client/src/app/context/_components/DocumentDetail/**` (new) | T9 | react-frontend-architecture, react-best-practices, next-best-practices | The **right pane**, presentational, props from T9. Header: repo-relative path, `used by N agents`, and a Preview/Edit two-state toggle using the existing `mode.preview`/`mode.edit` copy (AC-1, AC-5). Preview: the vendored `Markdown` primitive — **do not add `rehype-raw`**; that omission is what satisfies the untrusted-rendering NFR. Edit: the `Textarea` kit component seeded from on-disk content, a **Save** button, a **Discard** (AC-7), an unsaved indicator rendered **as text** (`aria-live="polite"`, never colour alone), the save outcome as an inline `role="status"` line (AC-6, Recommendation 3), and the always-present AC-28 note stating saves live only in DevDigest's local clone, are not committed or pushed, and can be lost on re-index. Conflict banner offering **exactly one** action, "reload the on-disk copy", with no force-overwrite and no diff (AC-9). No selection → the placeholder, never a blank pane (AC-3). Unreadable document → a named error that leaves the rest of the page usable (AC-4). `writable === false` → **Edit visibly unavailable** (disabled control + stated reason, not a hidden control) (AC-24). `"use client"` (it is interactive). Verify: `cd client && pnpm test && pnpm typecheck` green |
| T11 | client | ui | `client/src/app/context/_components/ContextView/ContextView.tsx`, `client/src/app/context/_components/ContextView/styles.ts`, `client/src/app/context/_components/ContextView/helpers.ts`, `client/src/app/context/_components/ContextView/ContextDocRow.tsx`, `client/src/app/context/_components/DocumentList/**` (new), `client/src/app/context/_components/dialogs/**` (new) | T9 | react-frontend-architecture, react-best-practices, next-best-practices | The **shell + left pane**. Two-pane master-detail layout: the flat repo-wide list stays visible alongside the detail pane with the **selected row visually marked** (AC-2), keeping today's row metadata (source category, token estimate, used-by). Toolbar: New file, New folder, Upload (a real `<input type="file" accept=".md">` behind a button — **no drag-and-drop**, AC-15) and Refresh/Re-index, each icon-only button carrying an **accessible name** (accessibility NFR). Status line: documents indexed + combined token estimate + last refreshed, all derived from the listing the server returned — and **delete the `chunks_indexed` rendering at `ContextView.tsx:50-52`** (AC-25, AC-26) and render **no COVERAGE badge** anywhere (AC-27). Dialogs, reusing `client/src/components/ConfirmDialog.tsx`: a name prompt for New file/New folder (a small local `NamePromptDialog`, no such component exists yet), the unsaved-changes confirmation (AC-8), and the **Re-index confirmation naming the consequence** — uncommitted clone edits will be discarded — which must not start the resync unless confirmed (AC-29). After a successful New file, select it and open it in **Edit** mode (AC-12); after New folder, show the inline "won't appear until it contains a document" note (AC-14, Recommendation 5). With no clone (`index.unavailable_reason` set) **disable every authoring action and show the reason** rather than failing at write time (AC-22). Verify: `cd client && pnpm test && pnpm typecheck` green; `grep -rn "chunks_indexed\|coverage" client/src/app/context/` returns nothing |

### Phase 7: Client verification (2 tasks — parallel-safe with each other)

Assign to the `test-writer` agent.

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T12 | client | test | `client/src/app/context/_components/ContextView/ContextView.test.tsx` (**rewrite** — the existing file pins the removed single-pane layout) | T11 | react-testing-library, react-best-practices | Few, long, user-flow tests with `userEvent` and mocked hooks/network at the boundary. Flow 1 (keyboard-only, accessibility NFR): tab to a row → select → the detail pane shows the content and the row is marked → switch to Edit → type → **Save** → the outcome line is queryable **by text** → Discard restores on-disk content, with visible focus throughout. Flow 2: with unsaved changes, selecting another document raises a confirmation and cancelling keeps the edits (AC-8); triggering Re-index raises the consequence-naming confirmation and **cancelling does not fire the resync mutation** (AC-29). Flow 3: a stale save returns 409 → the "your copy is stale" message with **exactly one** recovery action and no force/merge control present (AC-9). Flow 4: the status line renders documents + tokens + refreshed and **`getByText(/chunks/i)` finds nothing**, no coverage percentage is rendered anywhere (AC-25, AC-26, AC-27); each of the four toolbar buttons is reachable via `getByRole('button', { name: … })` (accessibility NFR); with `unavailable_reason` set they are all disabled with the reason shown (AC-22). Verify: `cd client && pnpm test && pnpm typecheck` green |
| T13 | client | test | `client/src/app/context/_components/DocumentDetail/DocumentDetail.test.tsx` (new) | T10 | react-testing-library, security | **NFR "untrusted rendering"** — render a document whose content contains `<script>window.__pwned=1</script>`, `<img src=x onerror="window.__pwned=1">` and `[click](javascript:alert(1))`, then assert: no `<script>` element in the container, no element carrying an `onerror` attribute, `window.__pwned` is undefined, and the link either has no `href` or an `href` that does not start with `javascript:`. Plus: the read-only case renders Edit as **visibly unavailable with a stated reason** (AC-24), the unsaved indicator is queryable **by text** and not by colour/class (AC-7), and the AC-28 local-clone-only warning is present whenever Edit mode is open. Verify: `cd client && pnpm test && pnpm typecheck` green |

### AC → task coverage map

All 29 acceptance criteria are covered; no orphans.

| AC | Goal | Tasks |
|---|---|---|
| AC-1 | G-1 | T1, T4, T5, T8, T10, T11 |
| AC-2 | G-1 | T11, T12 |
| AC-3 | G-1 | T8, T9, T10 |
| AC-4 | G-1 | T3, T4, T5, T10 |
| AC-5 | G-1, G-2 | T9, T10 |
| AC-6 | G-2 | T4, T5, T8, T9, T10, T12 |
| AC-7 | G-2 | T9, T10, T13 |
| AC-8 | G-2 | T9, T11, T12 |
| AC-9 | G-2 | T2, T4, T5, T8, T9, T10, T12 |
| AC-10 | G-2 | T4, T8, T11 |
| AC-11 | G-2 | T3, T6 |
| AC-12 | G-3 | T4, T5, T9, T11 |
| AC-13 | G-3 | T1, T4, T5, T11 |
| AC-14 | G-3 | T8, T11 |
| AC-15 | G-3 | T4, T5, T7, T8, T11 |
| AC-16 | G-3 | T3, T4, T6 |
| AC-17 | G-4 | T2, T3, T6 |
| AC-18 | G-4 | T2, T6 |
| AC-19 | G-4 | T3, T6 |
| AC-20 | G-4 | T3, T4, T6, T7 |
| AC-21 | G-4 | T5, T7 |
| AC-22 | G-4 | T4, T11, T12 |
| AC-23 | G-4 | T5, T7 |
| AC-24 | G-4, G-1 | T2, T4, T10, T13 |
| AC-25 | G-5 | T8, T11, T12 |
| AC-26 | G-5 | T11, T12 |
| AC-27 | G-5 | T11, T12 |
| AC-28 | G-5 | T8, T10, T13 |
| AC-29 | G-5, G-2 | T9, T11, T12 |

## Testing Strategy

- server (fast lane, the only lane this plan adds to):
  `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
- client: `cd client && pnpm test && pnpm typecheck`
- reviewer-core (untouched — regression guard only):
  `cd reviewer-core && npm test && npm run typecheck`
- mcp-server (untouched — regression guard only):
  `cd mcp-server && npm run test:unit && npm run typecheck`
- **No `.it.test.ts` file is added by this plan.** This feature stores nothing
  in Postgres, and T2/T3's root-injected design makes the entire security
  matrix testable with `mkdtemp` + `app.inject()`. If a task finds itself
  needing a real database, that is a signal it drifted from the layering — stop
  and re-check rather than adding a `.it.test.ts`.
- Add a new test only where a task's Acceptance criterion requires one. T12 is
  a **rewrite** of an existing file, not an addition — the current
  `ContextView.test.tsx` asserts the single-pane layout this plan replaces and
  will fail until it is rewritten.

## Risks & Mitigations

- **Writes into a tree that `git reset --hard` can erase.** `sync()` and a
  repeat `clone()` both hard-reset the clone (`server/src/adapters/git/simple-git.ts:71,98`),
  and `clone()` will `rm -rf` a clone directory that lost its `.git` (`:76`).
  *Mitigation:* accepted by the product owner (spec Resolved decisions Q4/Q5),
  surfaced not engineered away — AC-28 (always-on editor note, T10) and AC-29
  (confirm before re-index, T9/T11). The spec also states the residual gap
  deliberately: AC-29's trigger is session-scoped, so an edit saved before a
  page reload will not re-arm it.
- **Path traversal / symlink escape on a write — the highest-severity risk in
  this plan.** *Mitigation:* the write root check is layered on top of the
  existing clone-root check (T3's `resolveWriteTarget`), the pure rules are
  isolated in T2 where they can be exhaustively tested, and T6 asserts the whole
  rejection matrix **with a "nothing was written" assertion on every row** —
  a rejection that still creates a file is a failure.
- **TOCTOU between the collision check and the write.** `rename()` overwrites
  silently, so a save's atomic temp+rename must never be used for a *create*.
  *Mitigation:* T3 keeps two distinct entry points — `createNewFile` uses
  `flag: 'wx'` (fails if the target exists), `writeAtomic` is for the
  deliberate-overwrite save path only.
- **Case-insensitive filesystems.** `wx` alone is not enough on Linux (where
  `Spec.md` and `spec.md` are different files) and `findCollision` alone is
  racy. *Mitigation:* T3 does both, and T6 asserts the macOS-shaped case
  (AC-16).
- **AC-21 is easy to half-implement.** Raising the global registration would
  satisfy the context upload and silently break the second clause.
  *Mitigation:* Recommendation 1's per-request cap makes the skill-import limit
  untouchable by construction, T5's acceptance requires `git diff --stat server/src/app.ts`
  to be empty, and T7 asserts **both** halves.
- **Document content leaking into logs.** The observability NFR requires
  logging every write attempt and forbids logging content. *Mitigation:*
  spelled out in T5's acceptance — the log object carries `{ action, path,
  outcome }` and never the body.
- **Listing cost after every write.** `listDocuments` reads and tokenizes every
  discovered document (`service.ts:68-89`); in a repo like this one that is ~56
  reads per invalidation, and this plan invalidates the listing after every
  save/create/upload (AC-10). *Mitigation:* accepted for now — it is the same
  cost the shipped Re-index already pays, and AC-10 requires the refresh. If it
  becomes visible, the fix is a targeted single-document metadata patch in the
  query cache, not a body cache (AC-12 of the previous spec forbids caching
  bodies).
- **Vendored-mirror drift.** *Mitigation:* exactly one task (T1) may edit
  `vendor/shared`, in Phase 0, before anything else; its acceptance is a `diff`
  proving both `platform.ts` copies are byte-identical. This plan adds **only
  new schemas** and modifies none, so no existing fixture is forced to change
  (`client/INSIGHTS.md`, 2026-08-04).
- **The rebuild must not drop shipped behaviour.** `/context` today satisfies
  the previous spec's AC-1/AC-2/AC-3/AC-5 (row metadata, the exact `empty.*`
  copy, the index-unavailable state). *Mitigation:* called out in T11's row and
  asserted by T12; `context.json`'s `empty` block is explicitly keep-verbatim
  in T8.
- **T4 is the single bottleneck.** Six tasks sit downstream of it. *Mitigation:*
  its method surface is fully specified in its row, and T8 (client hooks + i18n)
  depends only on T1, so there is always startable work.

## Out of Scope

Specifications are reviewed here, not written here — the spec already exists at
`specs/2026-08-27-project-context-authoring.md` and nothing in this plan amends
it. Architecture review and security review are performed by separate reviewer
agents/skills (the `security` skill, `pr-self-review`, `architecture-reviewer`)
— not by `implementation-planner` or `implementer`. Given how much of this
feature is a new write surface, running `architecture-reviewer` and the
`security` skill over the branch **after** T7 lands is strongly advised.

Also explicitly out of scope, per the spec's Non-goals (REQ-7):

- The **COVERAGE** badge and score — omitted entirely, not stubbed (AC-27).
- **Rename, move, delete** of documents and folders.
- **Any git operation** — no commit, push, branch, PR, local-change diff or
  upstream conflict resolution. Save writes a file and stops.
- A **folder-tree** left pane; the list stays flat and repo-wide.
- **Autosave, draft recovery, per-keystroke undo** — Discard is the only undo.
- **Merge/diff UI** for a save conflict.
- **Drag-and-drop** upload.
- **Non-markdown** files.
- Attach/detach, token budgets, run-time injection, Run Trace — shipped by
  SPEC-2026-08-26-project-context and unchanged here. In particular
  `client/src/components/context-picker/**` is **not touched by any task in
  this plan**.
- **Multi-user concurrent editing** (presence, live cursors, merge). Two tabs of
  the same local user is covered only as the AC-9 conflict case.
- **`e2e/` coverage** and **documentation updates** — follow-ups
  (Recommendations 6 and 7); neither is assignable to `implementer`.
