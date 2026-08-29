# Spec: Project Context — document authoring (preview, edit, create, upload)
Spec ID: SPEC-2026-08-27-project-context-authoring
Status: approved
Supersedes: —
Related: [`specs/2026-08-26-project-context.md`](2026-08-26-project-context.md)
(SPEC-2026-08-26-project-context, status `approved`) — this spec picks up the
authoring UI that spec listed as a Non-goal ("the mockup's New file / New
folder / Upload / Edit / Save actions … **deferred to a follow-up spec**",
`specs/2026-08-26-project-context.md:117-122`, restated as REQ-8 in
`docs/plans/project-context.md:65-69`).

## Problem & user

**Who:** the same developer as the previous spec — someone who has connected a
repo in the DevDigest studio and is curating the grounding documents their
review agents read.

**Problem:** Project Context today is **read-only and metadata-only**. The
`/context` page renders a flat one-pane list of discovered documents
(`client/src/app/context/_components/ContextView/ContextView.tsx:88-101`), and
the listing endpoint deliberately returns `content: null` for every document
(`server/src/modules/context/service.ts:75-88`) — so there is **no way to read
a document's text inside DevDigest at all**, let alone change it. Even the
attach picker's Preview drawer shows only path/tokens/used-by, never content
(`client/src/components/context-picker/_components/PreviewDrawer.tsx:46-54`).

That leaves the user in a broken loop: DevDigest tells them "Drop your PRDs,
tech specs, and acceptance criteria under `.devdigest/specs/`"
(`client/messages/en/context.json:11-14`) but gives them no way to *put*
anything there — they must leave the app, find the clone on disk (or the
original repo), author the file in an editor, push, and re-sync before
DevDigest can see it. Attaching a document to an agent and discovering it says
the wrong thing means the same round trip again.

**This feature closes that loop:** a two-pane master-detail Project Context
screen where the left pane keeps the discovered-document list plus an
authoring toolbar (New file, New folder, Upload, Refresh), and the right pane
renders the selected document — **Preview** (rendered markdown) or **Edit**
(raw text with Save) — so a user can read, write and add grounding documents
without leaving DevDigest.

The client already carries unused copy for exactly this shape —
`mode.preview` / `mode.edit` and `editor.save` / `editor.saving` /
`editor.loadError` (`client/messages/en/context.json:15-23`) — left behind by
the course starter and rendered by nothing today.

**Why this is materially harder than what shipped:** every action in this spec
makes the server **write into a live git clone**. The shipped feature only ever
read, and the git adapter documents the clone as a read-only mirror it may
`reset --hard` at will: *"safe here because we never commit to or run code from
the clone"* (`server/src/adapters/git/simple-git.ts:89-99`, and the same
fetch+reset in `clone()`, `:57-73`). The only filesystem write anywhere in
`server/src` today is the local secrets file
(`server/src/adapters/secrets/local.ts:47-48`). There is no precedent here to
copy, and the existing `safeRepoPath`/`isWithin` containment work
(`server/src/modules/_shared/path-safety.ts:9-21`) was designed for reads.

**The decision taken** (see Resolved decisions Q4/Q5): DevDigest writes into
the clone's working tree and does **not** commit or push — the user commits
through their own git workflow outside the app. The resulting data-loss window
on re-index is accepted deliberately and made visible in the UI (AC-28,
AC-29), not designed away.

## Recommendations

Advice offered during spec review, with the product owner's disposition
recorded. Only the accepted items are reflected in Goals and Acceptance
criteria.

1. **Do not save into the git clone's working tree — save somewhere DevDigest
   owns.** — **REJECTED (accepted risk).** `SimpleGitClient` runs
   `git reset --hard origin/<branch>` on both `sync()` (`simple-git.ts:98`)
   and a repeat `clone()` (`simple-git.ts:71`), and `clone()` will `rm -rf` a
   clone directory that lost its `.git` (`simple-git.ts:76`), so uncommitted
   edits in that tree can be destroyed by a routine re-index. The product
   owner chose the simplest model — write the working-tree file, commit and
   push outside DevDigest — and to surface the risk instead of engineering
   around it (AC-28 states it in the editor, AC-29 gates re-index behind an
   explicit confirmation). Alternatives that would remove the window
   (DevDigest-owned directory, Postgres-backed documents, per-save local
   commit) remain available to a future spec.
2. **Allow writes under exactly one root — `.devdigest/specs/` — not every
   discovered folder.** — **ACCEPTED** (AC-17). Discovery is repo-wide across
   any `specs/`, `docs/` or `insights/` folder (`context/service.ts:246-255`),
   which in a repo like this one means ~56 documents including other packages'
   docs and `INSIGHTS.md` files; making all of them writable would turn
   Project Context into a general-purpose repo file editor. Read scope stays
   repo-wide, write scope is one root — they do not have to match (AC-24).
3. **Ship the COVERAGE badge in the COVERAGE spec, not this one.** —
   **ACCEPTED** (AC-27). The mockup's `78%` ring is the output of the
   Conformance Report feature (`2026-08-26-project-context.md:101-109`). The
   slot is omitted entirely rather than shown as a placeholder: a ring showing
   a number nobody can explain is worse than no ring.
4. **Keep Edit as a plain text area, not a rich/WYSIWYG markdown editor.** —
   **ACCEPTED** (AC-5). The client already vendors a `Markdown` primitive for
   the Preview half (`client/src/vendor/ui/primitives/Markdown.tsx`) and a
   `Textarea` kit component (`client/src/vendor/ui/kit/Textarea.tsx`). The
   audience is developers editing markdown they will also edit in their IDE.

## Goals / Non-goals

- **G-1:** Let a user read a discovered document's actual content inside
  DevDigest — a two-pane master-detail Project Context screen whose right pane
  renders the selected document's markdown, without leaving the page or losing
  the list.
- **G-2:** Let a user edit a selected document's markdown text in that same
  pane and save it back, with explicit save, an escape hatch (discard), and
  protection against silently clobbering a change made outside the app.
- **G-3:** Let a user add new grounding material from the toolbar — create a
  new markdown document, create a folder, or upload an existing file — and land
  in it immediately.
- **G-4:** Keep every write contained: a write may only ever land inside the
  connected repo's clone, under `.devdigest/specs/`, under a validated name,
  within a single size limit — and never through a symlink or a traversal.
- **G-5:** Keep the user honestly informed: what the status bar's numbers
  actually mean, that a save is local-clone-only and can be lost on re-index,
  and never showing a metric DevDigest doesn't really compute.

**Non-goals:**

- **Defining the COVERAGE score** — what it measures, how it's computed, what
  data it needs. It stays owned by the Conformance Report feature. This spec
  omits the badge entirely (AC-27).
- **Renaming, moving or deleting documents and folders.** The mockup shows no
  affordance for any of them.
- **Any git operation.** Save writes a file and stops: no commit, no push, no
  branch, no PR, no diff of local changes, no conflict resolution against
  upstream. The user commits and pushes through their own git workflow outside
  DevDigest.
- **A folder-tree left pane.** The left pane stays the flat, repo-wide file
  list discovery already produces (AC-2, Resolved decision Q13); empty folders
  are invisible by construction (AC-14).
- **Autosave, draft recovery, and per-keystroke undo history.** Save is
  explicit; Discard is the only undo (AC-6, AC-7).
- **Merge or diff UI for a save conflict.** A stale copy is reported and can
  be reloaded, losing local edits — nothing more (AC-9).
- **Drag-and-drop upload.** A toolbar file-picker button is the only upload
  entry point (AC-15).
- **Editing non-markdown files.** Discovery is markdown-only
  (`MARKDOWN_EXT`, `context/service.ts:58-61`) and stays that way.
- **Attaching/detaching documents, token budgets, run-time injection, Run
  Trace** — all shipped by SPEC-2026-08-26-project-context and unchanged here.
- **Multi-user concurrent editing** (presence, live cursors, merge). Two
  browser tabs of the same local user is in scope as a *conflict-detection*
  case (AC-9), not as collaboration.

## User stories

- As an agent author, I click `security-baseline.md` in Project Context, read
  the rendered PRD in the right pane, notice the rate-limit rule is stale,
  switch to **Edit**, fix the line, and **Save** — without opening my IDE.
- As someone onboarding a repo that has no grounding docs yet, I click **+**,
  name the file `public-api.md`, and start typing into the editor that opens —
  instead of reading "Drop your PRDs … under `.devdigest/specs/`" and being
  given no way to drop anything.
- As someone who already wrote a PRD elsewhere, I click **Upload**, pick the
  `.md` file off my laptop, and see it appear in the list, ready to attach to
  an agent.
- As someone who edited a doc in this tab and also in another tab, I hit
  **Save** and get told my copy is stale — instead of silently overwriting the
  other change.
- As someone about to hit **Re-index** after editing a doc, I get told that a
  resync throws away clone edits I haven't committed with git — before it
  happens, not after.

## Acceptance criteria (EARS)

**Reading a document in place (G-1)**

- **AC-1 (satisfies G-1):** WHEN a user selects a document in the Project
  Context list, the system shall display that document's current content, read
  fresh from the repo clone, in a detail pane rendered as markdown, together
  with the document's repo-relative path and its "used by N agents" count
  (already computed by `countAgentsByPath`, `context/service.ts:65,87`).
- **AC-2 (satisfies G-1):** WHILE a document is selected, the system shall keep
  the flat, repo-wide document list visible alongside the detail pane and shall
  visually mark the selected row, so moving between documents never requires
  leaving the page.
- **AC-3 (satisfies G-1):** IF no document is selected — including on first
  load, where the system shall not auto-select a document — THEN the system
  shall render a placeholder in the detail pane telling the user to choose a
  document, rather than a blank pane.
- **AC-4 (satisfies G-1):** IF the selected document cannot be read — deleted
  since the listing, unreadable, over the 400 KB `MAX_FILE_SIZE` cutoff
  (`server/src/modules/context/constants.ts:13`), or failing the containment
  check — THEN the system shall show an error in the detail pane naming the
  cause and shall leave the rest of the page usable.

**Editing and saving (G-2)**

- **AC-5 (satisfies G-2):** WHEN a user switches the detail pane to **Edit**,
  the system shall show the document's raw markdown text in an editable
  plain-text field seeded from the content currently on disk, and shall keep
  **Preview** and **Edit** as a two-state toggle on the same document.
- **AC-6 (satisfies G-2):** WHEN a user activates **Save**, the system shall
  immediately write the edited text to that document's path — with no
  intermediate confirmation step and with no autosave at any other moment —
  and shall confirm the outcome to the user (success, or failure with a stated
  reason), never leaving the user guessing whether the write happened.
- **AC-7 (satisfies G-2):** WHILE the editor holds unsaved changes, the system
  shall indicate the unsaved state as text (not colour alone) and shall offer a
  **Discard** action that restores the editor to the on-disk content without
  writing anything.
- **AC-8 (satisfies G-2):** IF a user selects a different document, switches to
  Preview, or navigates away while unsaved changes exist, THEN the system shall
  warn and require confirmation before discarding those changes.
- **AC-9 (satisfies G-2):** IF the document on disk has changed since the
  editor loaded it — another browser tab, an external edit, or a repo
  resync — THEN the system shall reject the save, tell the user their copy is
  stale, offer exactly one recovery action ("reload the on-disk copy",
  which discards the local edits), and shall not overwrite the newer content;
  it shall offer neither a force-overwrite nor a diff/merge view.
- **AC-10 (satisfies G-2):** WHEN a save succeeds, the system shall refresh the
  affected document's metadata — size, token estimate, last-modified — and the
  index-freshness status line without a full page reload.
- **AC-11 (satisfies G-2):** The system shall write a document's content
  atomically, so an interrupted or failed save never leaves the document
  truncated or half-written on disk.

**Creating and uploading (G-3)**

- **AC-12 (satisfies G-3):** WHEN a user activates **New file**, the system
  shall ask for a name, create an **empty** markdown document at that name
  under the write root, add it to the list, and open it in the detail pane in
  Edit mode.
- **AC-13 (satisfies G-3):** WHEN a user activates **New folder**, the system
  shall ask for a folder name and create that folder under the write root.
- **AC-14 (satisfies G-3):** IF a newly created folder contains no markdown
  document, THEN the system shall tell the user the folder will not appear in
  the document list until a document exists in it — expected behaviour, because
  discovery walks **files**, not directories (`walkClone` with
  `extensions: MARKDOWN_EXT`, `context/service.ts:58-61`), so an empty folder
  is invisible by construction.
- **AC-15 (satisfies G-3):** WHEN a user picks a file through the toolbar's
  upload button — the only upload entry point; drag-and-drop is not offered —
  the system shall accept it only if its extension is `.md`, its name passes
  AC-18 and its size passes AC-20, shall store it directly in
  `.devdigest/specs/`, and shall show it in the document list.
- **AC-16 (satisfies G-3):** IF a create or upload targets a name that already
  exists under the write root — compared **case-insensitively**, so `Spec.md`
  collides with `spec.md` on macOS — THEN the system shall reject the request
  with a stated collision message, and shall neither overwrite the existing
  document nor silently auto-rename the new one.

**Write-path safety (G-4)**

- **AC-17 (satisfies G-4):** The system shall accept a write only when the
  resolved target path lies inside the connected repo's clone root **and**
  under `.devdigest/specs/` — the single writable root, created if it does not
  exist yet — using the existing `safeRepoPath`/`isWithin` containment helpers
  rather than a bare `join()` (`server/src/modules/_shared/path-safety.ts:9-21`),
  rejecting every other target. A requested name may be a relative path of one
  or more segments beneath that root (e.g. `api/public.md`), each segment
  validated identically per AC-18.
- **AC-18 (satisfies G-4):** IF a requested file or folder name is absolute, or
  contains a `..` segment, a leading dot, a null byte or other control
  character, a character outside `A-Z a-z 0-9 . _ -`, or a segment longer than
  100 characters — or, for a file, does not end in `.md` — THEN the system
  shall reject the request without touching the filesystem.
- **AC-19 (satisfies G-4):** IF a write target resolves through a symlink, THEN
  the system shall reject it — preserving the property discovery already has,
  where the walker never follows symlinks
  (`server/src/modules/repo-intel/pipeline/walk.ts:89`) and reads re-check
  containment after `realpath` (`context/service.ts:212-218`).
- **AC-20 (satisfies G-4):** IF a save body or an upload exceeds the maximum
  document size of 400 KB (`MAX_FILE_SIZE`, `context/constants.ts:13`), THEN
  the system shall reject it with a stated reason before writing anything.
- **AC-21 (satisfies G-4):** The system shall enforce **one** document-size
  limit end to end: the multipart transport cap applied to a context-document
  upload shall equal `MAX_FILE_SIZE` (raised from today's
  `fileSize: 256 * 1024`, `server/src/app.ts:103`), so that no upload smaller
  than the document limit can fail with a generic transport error; raising it
  shall not raise the separate, deliberately smaller cap that skill import
  relies on.
- **AC-22 (satisfies G-4):** IF the repo has no clone on disk — the existing
  index-unavailable state (`context/service.ts:47-56`) — THEN the system shall
  disable every authoring action and show the reason, rather than failing at
  write time.
- **AC-23 (satisfies G-4):** The system shall scope every authoring request to
  the caller's workspace and repo, using the same tenancy resolution as the
  existing context reads (`getContext(container, req)`,
  `server/src/modules/context/routes.ts:26,38`).
- **AC-24 (satisfies G-4, G-1):** WHERE a selected document lies outside the
  `.devdigest/specs/` write root, the system shall present it as
  preview-only — the **Edit** control visibly unavailable with a stated reason
  — rather than allowing an edit that would be rejected at Save.

**Honest state (G-5)**

- **AC-25 (satisfies G-5):** The system shall display a status line for the
  document list stating how many documents are indexed, their combined token
  estimate, and when the index was last refreshed — all three derived from the
  listing the server actually returned — and shall not display a "chunks"
  figure, which Project Context does not compute
  (`2026-08-26-project-context.md:110-113`).
- **AC-26 (satisfies G-5):** IF a metric shown on this screen is not computed
  for these documents, THEN the system shall omit it rather than render a zero
  or a value borrowed from another feature — specifically, the page shall stop
  rendering `chunks_indexed`, which the context listing never sets
  (`ContextView.tsx:50-52` vs `context/service.ts:91-99`).
- **AC-27 (satisfies G-5):** WHERE a COVERAGE value is not defined and computed
  by its own specification, the system shall omit the coverage badge entirely
  from the Project Context header and from every document row — neither a real
  nor a placeholder percentage.
- **AC-28 (satisfies G-5):** WHILE a document is open in Edit mode, the system
  shall state that saved changes live only in DevDigest's local clone, are not
  committed or pushed, and can be lost when the repository is re-indexed unless
  the user commits them with git outside DevDigest — because `sync()` and a
  repeat `clone()` both run `git reset --hard origin/<branch>`
  (`server/src/adapters/git/simple-git.ts:71,98`), discarding uncommitted
  working-tree changes without warning.
- **AC-29 (satisfies G-5, G-2):** IF a user triggers **Re-index** while the
  editor holds unsaved changes, or after this session has saved, created or
  uploaded any document since the last successful index refresh, THEN the
  system shall require an explicit confirmation naming the consequence
  (uncommitted changes in the clone will be discarded) and shall not start the
  resync unless the user confirms.

## Edge cases

- **A resync eats every clone edit the user hasn't committed with git.** The
  clone is documented as a mirror that is safe to hard-reset precisely
  *because* "we never commit to or run code from the clone"
  (`simple-git.ts:89-92`); writing user content into that tree invalidates the
  premise, and a repeat `clone()` whose `.git` went missing does `rm -rf` on
  the whole directory (`simple-git.ts:76`). This is an **accepted risk**
  (Recommendation 1, Resolved decisions Q4/Q5), mitigated by AC-28 and AC-29.
  **Residual gap, stated deliberately:** AC-29's trigger is session-scoped, so
  an edit saved before a page reload — or made in another tab — will not fire
  the confirmation; AC-28's always-present editor note is the only warning in
  that case.
- **Save never touches git.** No commit, no push, no branch, and therefore no
  interaction with the shallow clone depth (`CLONE_DEPTH`, `--depth` in
  `simple-git.ts:78`) or with the read-only credentials used for cloning.
- **The multipart limit is registered app-globally.** `@fastify/multipart` is
  registered once for the whole app with `fileSize: 256 * 1024`
  (`server/src/app.ts:103`), and its comment ties that number to skill import
  ("skills are short instruction texts, not general file storage"). AC-21
  requires the context-document upload to allow 400 KB *without* loosening the
  skill-import cap — the two now need distinct effective limits.
- **Editing a document that is currently attached to a running agent.** Bodies
  are read fresh at run time with no caching (`readBodies`,
  `context/service.ts:150-169`), so a save mid-run can change what a
  still-executing run reads, and two agents in the same batch can see different
  text for the same path. Nothing fails; the trace stays truthful because it
  records what was actually injected.
- **Editing a document while it's open in the attach picker's Preview drawer**
  in another tab — the drawer shows metadata only today
  (`PreviewDrawer.tsx:46-54`), so it will show a stale token count until
  refetch.
- **A document that is discovered but not writable** — every document outside
  `.devdigest/specs/`, which is most of them in a repo like this one. AC-24
  makes Edit visibly unavailable for those instead of failing at Save.
- **`.devdigest/specs/` may not exist yet** in a freshly connected repo — the
  very case the empty state addresses. Creating the first document has to
  create the folder too (AC-17).
- **The repo may have `.devdigest/` `.gitignore`d**, in which case an authored
  document can never be committed and is invisible to everyone outside this
  machine — and is destroyed by the next re-index with no recourse. AC-28's
  note is the user's only signal.
- **Case-insensitive filesystems.** macOS treats `Spec.md` and `spec.md` as the
  same file, so AC-16's collision check compares case-insensitively rather than
  by exact string.
- **Markdown that renders as HTML.** Document content is untrusted repo content
  (previous spec, "Untrusted inputs"); the Preview pane is the first place it is
  ever *rendered* rather than shipped to an LLM inside `<untrusted>`. Script
  tags, `javascript:` links and `onerror` attributes are in play — see NFR
  Security.
- **A saved document containing prompt-injection text** is unchanged in risk:
  `wrapUntrusted` + `INJECTION_GUARD` still apply at run time
  (`reviewer-core/src/prompt.ts:16-28,30-34`). Authoring adds no new
  injection surface *into the model* — only a faster way to author the payload,
  which for a first-party local tool is the user hurting themselves.
- **Two browser tabs, one user** — the concurrency case AC-9 covers; DevDigest
  is a local-first single-user studio, so this, not real multi-user editing, is
  the realistic collision.
- **Disk full / read-only filesystem / permission denied** at write time —
  must surface as a stated failure, not a silent no-op (AC-6).
- **The left pane keeps showing repo-wide paths while only one root is
  writable.** Image 17 shows a single root `.devdigest/specs/` with flat
  filenames; images 15/16 show repo-wide paths (`client/docs/…`,
  `server/insights/…`), which is what the shipped walker actually produces
  (`context/service.ts:246-255`). The list stays repo-wide (read scope), and
  the asymmetry is made legible by AC-24 rather than by narrowing the list.
- **The current page is a single-pane list.** Adopting master-detail rewrites
  the layout that satisfies the previous spec's AC-1/AC-2/AC-3/AC-5 — those
  behaviours (metadata columns, empty state copy, unavailable state) must
  survive the change, not be dropped with the old layout. The row keeps its
  shipped metadata (source category, token estimate, "used by N agents"); the
  detail header carries path, Preview/Edit toggle and used-by.
- **`SpecFile.content` already exists in the contract** and is always `null`
  today (`server/src/vendor/shared/contracts/platform.ts:262-273`,
  `context/service.ts:80`) — reusing it for the detail pane must not
  accidentally start shipping bodies in the *list* response, which an NFR of
  the previous spec forbids ("list without bodies").

## Workflow & communication

Five flows, all between the existing client ↔ server ↔ clone triangle. Contract
shapes only — no file or module assignments.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant WEB as client<br/>/context (two-pane)
  participant API as server<br/>Fastify :3001
  participant FS as Repo clone<br/>~/.devdigest/workspace/&lt;owner&gt;/&lt;repo&gt;
  participant PG as Postgres

  rect rgb(240,246,255)
  note over U,PG: 1 — Select & preview (G-1)
  U->>WEB: click a document row
  WEB->>API: GET document content by path
  API->>FS: containment-checked read (safeRepoPath + isWithin + realpath)
  API->>PG: used_by count
  API-->>WEB: { path, content, size, updated_at, source, tokens, used_by, revision, writable }
  WEB-->>U: rendered markdown + header (path · Preview/Edit · used by N)
  end

  rect rgb(245,255,245)
  note over U,FS: 2 — Edit & save (G-2)
  U->>WEB: switch to Edit, change text, Save (immediate)
  WEB->>API: PUT document { path, content, expected_revision }
  API->>API: validate root + name + size (AC-17…AC-21)
  API->>FS: compare current revision
  alt revision matches
    API->>FS: atomic write (temp + rename), no git commit
    API-->>WEB: { path, size, updated_at, tokens, revision }
    WEB-->>U: saved; metadata + status line refreshed
  else revision differs (AC-9)
    API-->>WEB: conflict — on-disk copy is newer
    WEB-->>U: "your copy is stale" → only "reload the on-disk copy"
  end
  end

  rect rgb(255,250,240)
  note over U,FS: 3 — New file / New folder (G-3)
  U->>WEB: toolbar + / new-folder, enter a name
  WEB->>API: POST create { kind: file|folder, path }
  API->>API: validate name + root; reject collision (AC-16, AC-18)
  API->>FS: create under .devdigest/specs/ (creating the root if absent)
  API-->>WEB: created document/folder (or a stated rejection)
  WEB-->>U: list refreshed; new empty file opens in Edit mode
  end

  rect rgb(255,245,250)
  note over U,FS: 4 — Upload (G-3)
  U->>WEB: toolbar upload button, pick a .md file
  WEB->>API: POST upload (multipart, one file, cap = MAX_FILE_SIZE)
  API->>API: extension + size + name checks (AC-15, AC-18, AC-20)
  API->>FS: write into .devdigest/specs/
  API-->>WEB: stored document (or a stated rejection)
  WEB-->>U: list refreshed, document selectable
  end

  rect rgb(248,248,248)
  note over U,FS: 5 — Re-index guard (G-5)
  U->>WEB: click Re-index
  WEB-->>U: confirm — uncommitted clone edits will be discarded (AC-29)
  U->>WEB: confirm
  WEB->>API: POST re-index
  API->>FS: git sync (reset --hard) + re-walk
  API-->>WEB: refreshed listing + index status
  end
```

**Contracts this feature depends on or extends** (shapes, not implementations):

| Contract | Today | This feature |
|---|---|---|
| `SpecFile` (`server/src/vendor/shared/contracts/platform.ts:262-273`) | `{ path, content?, size?, updated_at?, source, tokens?, used_by? }`; `content` always `null` in listings | reused as-is for the list; the **detail** response populates `content` — the list must keep sending `null` |
| document read | none — no endpoint returns a body | new single-document read: `{ path, content, size, updated_at, source, tokens, used_by, revision, writable }`, where `revision` is an opaque change token for AC-9 and `writable` drives AC-24 |
| document write | none | `{ path, content, expected_revision }` → updated metadata, or a distinct conflict outcome; never a git commit |
| create file / folder | none | `{ kind: 'file' \| 'folder', path }` → created entry, or a stated rejection reason; `path` is relative to `.devdigest/specs/` |
| upload | `@fastify/multipart` registered globally, `fileSize: 256 * 1024, files: 1` (`server/src/app.ts:103`) | context-document uploads capped at `MAX_FILE_SIZE` (400 KB) instead, without loosening skill import's cap (AC-21) |
| `ContextListing` / `ContextIndexStatus` (`platform.ts:288-301`) | `{ files, index: { status, pct, doc_count, refreshed_at, unavailable_reason } }` | reused; the status line renders documents + tokens + refreshed-at from it (AC-25), and a successful write invalidates it (AC-10) |
| existing i18n keys (`client/messages/en/context.json:15-23`) | `mode.preview`, `mode.edit`, `editor.save`, `editor.saving`, `editor.loadError` — present, unused | become the copy for the detail pane |

Both `vendor/shared` mirrors are do-not-touch-without-coordination
(`server/CLAUDE.md`, `client/CLAUDE.md`); any contract addition here is one
coordinated edit, exactly as the previous feature handled it.

## Non-functional requirements

- **Security — write containment.** No write shall ever resolve outside the
  clone root or outside `.devdigest/specs/`, including via `..`, an absolute
  path, a backslash variant, a symlinked directory, or a case-folded duplicate.
  *(verify: unit tests attempting `../../../../etc/passwd`, `/etc/passwd`,
  `..\\..\\x.md`, a path through a symlinked folder, a target in another
  discovered `docs/` folder, and a name differing only in case — each rejected
  with nothing written to disk.)*
- **Security — untrusted rendering.** The Preview pane shall render document
  markdown as data: no script execution, no raw HTML event handlers, and no
  `javascript:` URLs. *(verify: a component test rendering a document
  containing `<script>`, `<img onerror=…>` and a `javascript:` link, asserting
  none of them produces executable output or a live link.)*
- **Security — upload validation.** An upload shall be validated on extension,
  name and size on the **server**, independent of any client-side filter, and
  its stored name shall be derived from validation rather than trusted verbatim
  from the client. *(verify: a request test uploading a `.txt` file, a body
  over 400 KB, and a traversal filename — each rejected with no file created,
  and a skill-import upload over 256 KB still rejected per AC-21.)*
- **Reliability — atomic writes.** A save shall never leave a partially written
  document. *(verify: a test asserting the target file's content is either the
  full previous or the full new content after a simulated mid-write failure.)*
- **Performance — bodies on demand only.** Document bodies shall be fetched
  only for the selected document, never as part of the list response.
  *(verify: measure the list response size with ~50 documents — it must still
  scale with metadata, not total document bytes, as the previous spec's NFR
  requires.)*
- **Accessibility.** The two panes, the Preview/Edit toggle, the toolbar
  buttons, the re-index confirmation and the unsaved/conflict messages shall be
  reachable and operable by keyboard alone with visible focus; the toolbar's
  four icon-only buttons shall each expose an accessible name; unsaved,
  conflict and read-only states shall be conveyed as text, not colour alone.
  *(verify: keyboard-only walkthrough select → Edit → type → Save → Discard →
  Re-index confirm; a component test asserting each toolbar button has an
  accessible name and that the unsaved indicator is queryable by text.)*
- **Observability.** Every write attempt — create, save, upload — shall be
  logged server-side with the action, the repo-relative path and the outcome
  (including the rejection reason), and no log line shall contain document
  content. *(verify: trigger one successful save and one rejected traversal;
  both appear in the server log with path and outcome, and neither contains the
  document body.)*

## Inputs and provenance

- **Existing document content and paths** — markdown inside the repo clone at
  `<cloneDir>/<owner>/<repo>` (`server/src/adapters/git/simple-git.ts:37-39`),
  produced by `git clone` from the connected repository. Provenance:
  **third-party / repo-authored**.
- **Edited document text** — typed by the user into the detail pane's Edit
  mode. Provenance: **user-authored, first-party** — but it becomes
  repo-content the moment it is written, and is re-read as untrusted at run
  time like any other document.
- **Uploaded file bytes and the client-supplied filename** — chosen by the user
  from their local machine. Provenance: **user-supplied, unvalidated until the
  server validates it**; the filename in particular is attacker-shaped input in
  the general case.
- **New file / folder names and relative paths** — user-typed strings that
  become filesystem paths beneath `.devdigest/specs/`.
- **`revision` / conflict token, token estimates, size, last-modified,
  `writable`** — derived server-side from the file on disk, not user-supplied.

## Untrusted inputs

- **Filenames and relative paths (new, uploaded, or selected)** are the primary
  untrusted input here and are used to build filesystem *write* targets — the
  sharpest change from the shipped read-only feature. They shall pass name
  validation (AC-18) and containment (AC-17, AC-19) before any filesystem call,
  and shall be treated as untrusted text when echoed back into the UI or into
  logs.
- **Uploaded file bytes** are untrusted: unvalidated size, possibly not
  markdown at all despite a `.md` extension.
- **Document bodies** (existing or newly saved) stay untrusted on both consumer
  paths: rendered in Preview (NFR untrusted rendering) and injected at run time
  only inside `<untrusted source="spec-N">` with `INJECTION_GUARD` in the system
  message (`reviewer-core/src/prompt.ts:16-28,30-34`) — unchanged by this spec.
- **What is NOT untrusted:** the user's own selection of which document to open,
  and DevDigest's own derived metadata (size, tokens, revision, `writable`).

## Open questions

None. Every question raised during spec review was resolved by the product
owner on 2026-08-27 and folded into the requirements above — see **Resolved
decisions**.

## Resolved decisions

Kept as a short decision log; each decision is already reflected in the
Goals / Acceptance criteria / Non-goals above.

- **Q1 — write root:** `.devdigest/specs/` only. Every write action (New file,
  New folder, Upload, Save) targets that single root; no other discovered
  `specs/`/`docs/`/`insights/` folder, and no other package's files, are
  writable (AC-17). Read/preview stays repo-wide (AC-2, AC-24).
- **Q2 — name validation:** `A-Z a-z 0-9 . _ -`, max 100 characters per
  segment, files must end in `.md`; no absolute paths, no `..`, no leading dot,
  no control characters. A name may be a relative path of one or more segments
  beneath the write root (`api/public.md`), each segment validated identically
  (AC-17, AC-18).
- **Q3 — size limit:** one limit, 400 KB (`MAX_FILE_SIZE`,
  `context/constants.ts:13`). The multipart transport cap for context-document
  uploads is raised from 256 KB to match, without loosening skill import's own
  cap (AC-20, AC-21).
- **Q4 — git persistence:** option (a) — Save rewrites the working-tree file in
  the clone and nothing else. No commit, no push, no PR. The user commits and
  pushes through their normal git workflow outside DevDigest (Non-goals,
  AC-28).
- **Q5 — resync data loss:** accepted, but never silent. Re-index requires an
  explicit confirmation naming the loss when the session has unsaved editor
  changes or has written any document since the last refresh (AC-29), and the
  editor always states that saves are local-clone-only (AC-28). Blocking the
  resync, auto-backup and per-save commits were all rejected as over-build for
  this iteration (Recommendation 1).
- **Q6 — Save UX:** immediate write on click, no confirmation step, no
  autosave, no draft recovery, no per-keystroke undo — Discard is the only undo
  (AC-6, AC-7).
- **Q7 — conflict policy:** the save is rejected and the user is offered one
  action, "reload the on-disk copy", which discards local edits. No
  force-overwrite, no diff, no merge UI (AC-9).
- **Q8 — upload rules:** `.md` only; the file lands directly in
  `.devdigest/specs/` (there is only one writable root, so no folder picker is
  needed); toolbar file-picker button only, no drag-and-drop (AC-15).
- **Q9 — empty folders:** accepted as expected behaviour. Discovery walks
  files, so a folder with no markdown in it simply does not appear in the list
  until a document is added to it; the user is told so at creation time
  (AC-14). No folder-tree UI is built (Non-goals).
- **Q10 — COVERAGE:** out of scope for this spec. The badge is omitted
  entirely — not a real percentage, not a placeholder one — until a separate
  COVERAGE / Conformance Report spec defines and computes it (AC-27,
  Recommendation 3).
- **Q11 — delete / rename / move:** out of scope, matching the mockup, which
  shows no affordance for any of them (Non-goals).
- **Q12 — status line metric:** documents + total token estimate + last
  refreshed. No "chunks" figure — Project Context does not chunk documents, and
  the page stops rendering the `chunks_indexed` field the context listing never
  populates (AC-25, AC-26).
- **Q13 — left-pane root label:** the left pane stays the flat, repo-wide list
  discovery actually returns (images 15/16), not the single-root view of image
  17. The read/write asymmetry is communicated per-document instead (AC-24).
- **Q14 — layout replacement:** the two-pane master-detail view replaces
  today's single-pane `/context` list. The row keeps the shipped metadata
  (source category, token estimate, "used by N agents"); the detail header
  carries the path, the Preview/Edit toggle and the used-by count (Edge cases).
