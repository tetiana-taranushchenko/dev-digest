# Development Plan: Project Context

Source spec: [`specs/2026-08-26-project-context.md`](../../specs/2026-08-26-project-context.md)
(SPEC-2026-08-26-project-context, status `approved`).

## Context

DevDigest agents review a PR against the diff, `repo-intel` context, linked
skills, and the agent system prompt — but never against the project's own
written intent. The plumbing already exists and is unfed: `reviewer-core`
accepts `specs?: string[]` (`reviewer-core/src/review/run.ts:75`) and renders it
as `## Project context` with each entry `wrapUntrusted`-wrapped
(`reviewer-core/src/prompt.ts:161-165,198-200`), the trace contract already
carries `prompt_assembly.specs` and `specs_read`
(`server/src/vendor/shared/contracts/trace.ts:43,89`), and the Run Trace drawer
already renders both (`client/.../TraceBody/TraceBody.tsx:50-62,96-98`). Nothing
populates them. This plan closes that loop: discover repo markdown, attach
chosen documents to an agent or skill, inject them verbatim at run time, and
make exactly what was injected inspectable afterwards.

## Requirements (as reviewed)

Restated from the approved spec — not authored here. Goals G-1…G-5 and
acceptance criteria AC-1…AC-22 are quoted by ID; see the spec for full EARS text.

- **REQ-1 (G-1 / AC-1…AC-5, AC-20, AC-22):** Browse every markdown document
  discovered repo-wide under a top-level `specs/`, `docs/`, or `insights/`
  folder (`.devdigest/specs/` counts as an instance of `specs/`), each with file
  name, folder, source category (`docs | spec | insights`), estimated tokens,
  and "used by N agents"; plus an index-freshness line, a Re-index action, an
  index-unavailable state when the clone is missing, and exclusion of documents
  over 400 KB.
- **REQ-2 (G-2 / AC-6…AC-9):** Attach/detach documents to an agent (Agent Editor
  "Context" tab) and to a skill (Skill Editor context section), persisting an
  **ordered list of repo-relative paths only** — never a document body. An
  attached path that no longer resolves is shown as missing, not dropped.
- **REQ-3 (G-3 / AC-10, AC-11):** Show a per-document token estimate; the agent
  total is the combined direct + enabled-linked-skill set deduped by path, the
  skill total is that skill's own set. Over the soft cap → a warning badge that
  never blocks; under `map-reduce` strategy → a note that the cost repeats per
  changed file.
- **REQ-4 (G-4 / AC-12…AC-15, AC-21):** At run time resolve every attached
  document (direct + enabled linked skills) fresh from the repo clone with no
  body caching, ordered direct-first then per skill in `agent_skills.order`,
  deduped first-occurrence-wins, and pass them as `specs` to
  `reviewPullRequest`. An unreadable document is omitted, logged, and does not
  fail the run. The CI/GitHub-runner path resolves the same paths from
  `.devdigest/agents/<slug>.yaml`'s `AgentManifest` instead of the database.
- **REQ-5 (G-5 / AC-16…AC-19):** The Run Trace's Prompt assembly shows a block
  labelled exactly **"Project context — attached specs (untrusted)"** with the
  complete injected text verbatim (searchable, copyable); `specs_read` lists
  every injected path; a run that injected nothing renders "none" and omits the
  block.
- **REQ-6 (Contracts, spec §"Contracts this feature depends on or extends"):**
  Extend `SpecFile` with `source` / `tokens` / `used_by`, extend the
  `code_chunks.source` enum with `insights`, extend `AgentManifest` to carry
  attached document paths. The `vendor/shared` mirror edit is one coordinated
  change (Q8).
- **REQ-7 (NFRs):** Untrusted handling verified by a prompt test; path
  containment via `safeRepoPath`/`isWithin`, never a bare `join()`, verified by
  a traversal unit test; no body persistence verified by row inspection; listing
  without bodies verified by response size; keyboard accessibility and a text
  (not colour-only) over-cap label verified by a walkthrough + component test;
  token estimate derived from the same estimator the server uses.
- **REQ-8 (Non-goals — explicitly excluded from this plan):** the COVERAGE score
  / Conformance Report; semantic/embedding chunk retrieval; non-markdown files;
  any change to `reviewer-core`'s prompt structure; and document authoring/
  editing UI (New file / New folder / Upload / Edit / Save) — deferred to a
  follow-up spec.

## Recommendations

Advice for you to accept or reject. Items 1-2 are already reflected in the task
table because an NFR effectively forces them; the rest are not folded in.

1. **Adopt spec Recommendation 1 — server-side tokenizer.** The NFR "Cost
   transparency" requires the displayed estimate to match the server's
   estimator, so T7 uses the existing `container.tokenizer`
   (`server/src/platform/container.ts:136-139` → `TiktokenTokenizer`,
   `server/src/adapters/tokenizer/index.ts:25-40`) rather than a client-side
   `body.length / 4`. Reject this and NFR "Cost transparency" and REQ-1's
   "list without bodies" become mutually hard to satisfy.
2. **Adopt spec Recommendation 2 — server-owned cap constant.** `CONTEXT_TOKEN_CAP`
   lives in `server/src/modules/context/constants.ts` next to the precedent
   `DEFAULT_REPO_MAP_TOKEN_BUDGET` (`server/src/modules/repo-intel/constants.ts:51`)
   and is returned by the API for the UI to read (T7/T8), instead of a client
   constant that can't be enforced at run time.
3. **Do not adopt spec Recommendations 3 and 4 in this plan.** Attach-time
   `scanForInjectionRisk` (Rec 3) and per-slot token attribution in the trace
   (Rec 4) are not required by any of AC-1…AC-22. Rec 3 is a cheap add-on to T9/T10
   if you want it — say so and I will add it as its own task.
4. **AC-21 has no call-site in this repo — scope it to contract + resolver.**
   `AgentManifest` appears only in its own contract file
   (`server/src/vendor/shared/contracts/eval-ci.ts:152-171`); there is no
   `CiService`, no `POST /agents/:id/export-ci` route, and no runner package
   (`grep -rn "AgentManifest\|agentYaml\|export-ci" server/src client/src reviewer-core/src`
   returns only the contract and a comment in `reviewer-core/src/review/run.ts:30`).
   The manifest's `skills` field likewise *declares* slugs that nothing in this
   repo resolves. T5 therefore ships the contract field plus a pure, unit-tested
   resolver, and the wiring lands with the runner. If you would rather move AC-21
   to a follow-up spec entirely, drop T5 and the manifest part of T1.
5. **Extend `walkClone`, don't write a second walker.** Parameterising
   `server/src/modules/repo-intel/pipeline/walk.ts` (T3) inherits the two
   properties the spec's edge cases demand for free: symlinks are never followed
   (`walk.ts:89`) and `MAX_FILE_SIZE` is already enforced (`walk.ts:112-115`,
   `constants.ts:43` = AC-20). A fresh markdown walker would have to re-derive both.
6. **Use `.nullish()` for the new `SpecFile` fields, not `.nullable()`.**
   `client/INSIGHTS.md` (2026-08-04, "A zod `.nullable()` field is REQUIRED")
   records that `.nullable()` forced updates across three fixtures plus
   `server/test/contracts.test.ts`. `.nullish()` is the low-blast-radius choice
   here since `SpecFile` already uses it for `content`/`size`/`updated_at`
   (`platform.ts:260-262`).
7. **Response shape change for the stub hook.** AC-1 + AC-3 need documents *and*
   index freshness from `GET /repos/:id/context`, but the existing stub hook
   types it as a bare `SpecFile[]` (`client/src/lib/hooks/core.ts:145-151`).
   The plan returns `{ files, index }` and has T12 update the hook. Flagging it
   because it changes a shape the client already assumes.
8. **e2e coverage is a follow-up.** `e2e/` is out of scope for `implementer`;
   an `agent-browser` flow for attach → run → trace should be authored by hand
   after this plan lands.

### Spec citations that have drifted (verified against current code)

Not errors in the plan — just so the implementer trusts the code over the spec text:

- Spec says `AgentManifest` `skills` is at `eval-ci.ts:148-150`; the docblock is
  at `:145-151` and the `skills` field is at `:158-162`.
- Spec says `agent_versions.config_json` is at `agents.ts:45`; it is at `:44`.
- Spec says `prompt.ts:162-165` for `specsBlock`; it starts at `:161`.
- **The two `vendor/shared` mirrors are byte-identical for `platform.ts` and
  `trace.ts`** (`diff -rq server/src/vendor/shared client/src/vendor/shared`
  reports differences only in `adapters.ts`, `eval-ci.ts`, `knowledge.ts`,
  `productionize.ts`). `AgentManifest` exists **only** in the server mirror —
  the client's `eval-ci.ts` has no such export — so the manifest change is a
  server-only edit and must **not** be copied into the client mirror.

## Execution Mode

**Multi-agent (parallel `implementer` instances).**

*Assumption, not a confirmation:* this session runs in auto/no-interruption
mode, so per the standing default I chose multi-agent because the work splits
naturally into disjoint owned paths per module — server context module, server
run-executor, server manifest resolver, client shared picker, client page,
client agent tab, client skill tab, client trace label. Phases 0 and 2 are
deliberately single-task bottlenecks (shared contracts, shared service); every
other phase is a parallel wave. If you would rather run one sequential
`implementer` pass, the phase order below already is a valid sequential order —
nothing needs to change except how many agents you launch.

## Affected Modules & Contracts

- **server** (`@devdigest/api`) — new `modules/context/` module (full
  routes → service → repository split), `repo-intel/pipeline/walk.ts`
  parameterisation, `reviews/run-executor.ts` injection, DB schema + migration,
  one container facade.
- **client** (`@devdigest/web`) — new `/context` page, shared attach picker,
  Agent Editor Context tab, Skill Editor context section, one Run Trace label,
  one vendored nav entry.
- **reviewer-core** — **no production change.** AC-13 explicitly says this
  feature adds no new prompt-assembly path; the only reviewer-core work is a new
  test (T6) pinning the NFR that already holds.
- **mcp-server** — untouched.
- **e2e** — out of scope (see Recommendation 8).

**Contract changes in `@devdigest/shared` (vendored):**

| File | Change | Mirrors |
|---|---|---|
| `contracts/platform.ts` | `ContextSource` enum (`docs \| spec \| insights`); `SpecFile` gains `source`, `tokens`, `used_by`; new `ContextListing`, `AttachedContextDoc`, `SetContextPathsBody` | **both** mirrors, byte-identical, one task (T1) |
| `contracts/eval-ci.ts` | `AgentManifest` gains an attached-document-paths field | **server mirror only** — the client mirror has no `AgentManifest` |
| `contracts/trace.ts` | none — `specs` and `specs_read` already exist | — |

## Architecture Notes

**Onion layers touched** (see `.claude/skills/onion-architecture/LAYER_MAP.md`):

- *Presentation* — `modules/context/routes.ts` (new), `modules/agents/routes.ts`,
  `modules/skills/routes.ts`, `modules/index.ts` registry.
- *Application* — `modules/context/service.ts` (new), `modules/agents/service.ts`,
  `modules/skills/service.ts`, `modules/reviews/run-executor.ts`.
- *Infrastructure* — `modules/context/repository.ts` (new), `db/schema/*`,
  `platform/container.ts` (composition root — the one file allowed to wire the
  new facade).
- *Domain* — untouched. `reviewer-core` stays framework/infra-agnostic; nothing
  in this plan may import server types into it.

The context module earns the **full split**: it coordinates the filesystem, the
DB link tables, and the tokenizer adapter, and computes derived values (token
estimate, `used_by`, dedupe order) — that is squarely on the "yes" side of the
graduated-layering test. `modules/agents/` and `modules/skills/` already have
services, so no retrofit is involved.

**Do-not-touch items in play:**

- `server/src/vendor/shared/` + `client/src/vendor/shared/` — "never hand-edit
  without coordination" (`server/AGENTS.md:13`, `client/AGENTS.md:13`).
  **Exactly one task (T1) may edit these trees.** Its acceptance includes a
  `diff` proving both `platform.ts` copies are byte-identical afterwards.
- `client/src/vendor/ui/` — "vendored/mirrored; edit deliberately"
  (`client/AGENTS.md:13`). Only T14 touches it, and only to add one `NAV` entry
  (`client/src/vendor/ui/nav.ts:21-37`) so that the already-present
  `activeKeyFor` mapping for `/context` (`client/src/components/app-shell/helpers.ts:30`)
  has a sidebar item to highlight. `vendor/ui` has **no server mirror**
  (`server/src/vendor/` contains only `shared/`), so this is client-local.
- `server/src/db/migrations/` — never hand-edit. Per `server/INSIGHTS.md`
  (2026-08-04, "Don't hand-write migrations"), the real workflow is: edit
  `src/db/schema/*.ts` → `pnpm db:generate` → `pnpm db:migrate`. T2 must follow
  exactly that.
- `reviewer-core/src/grounding.ts` — untouched; nothing here goes near the
  citation gate.

**Relevant INSIGHTS entries:**

- `client/INSIGHTS.md` — "A zod `.nullable()` field is REQUIRED (just
  null-valued); `.nullish()` is what makes it optional" (2026-08-04). Drives T1's
  field modifiers.
- `server/INSIGHTS.md` — "Don't hand-write migrations; edit `schema/*.ts` and run
  `pnpm db:generate`" (2026-08-04). Drives T2.
- `server/INSIGHTS.md` — "A field computed in `reviewer-core` can be silently
  dropped by destructuring in `run-executor.ts`" (2026-08-04). Drives T11:
  `run-executor.ts:308` destructures `outcome`; adding data there needs an
  explicit read, TypeScript will not warn.
- `server/INSIGHTS.md` — "`pnpm db:migrate` fails with 'column already exists' if
  the local Postgres volume predates a migration file" (2026-08-05). Expect
  `docker compose down -v && ./scripts/dev.sh` when verifying T2 locally.
- `client/INSIGHTS.md` — "Formatters used by >1 component tree belong in
  `client/src/lib/format.ts`" (2026-08-04). Drives putting the attach picker in
  `client/src/components/` (T12), not inside one editor tree.

**Security-critical invariant (NFR "path containment", spec Edge cases):**
every read of an attached path goes through `safeRepoPath` + `isWithin`
(`server/src/modules/_shared/path-safety.ts:9-21`), the pattern already used by
`intent/signals.ts` and `conventions/extractor.ts`. The **unguarded** `readClone`
(`server/src/modules/repo-intel/service.ts:923-925`, a bare
`readFile(join(clonePath, file))`) must **not** be copied or called by any task
in this plan. This applies to T7 (studio read) and T5 (manifest/CI read) alike.

## Phases

Dependency graph (acyclic): T1 → T2 → T4 → T7 → {T8, T9, T10, T11}; T1 → T3 → T7;
T1 → T5; T7 → T12 → {T14, T15, T16}; tests depend on the code they cover.
In a phase, tasks with no shared owned path and no edge between them are
parallel-safe.

### Phase 0: Contracts & storage foundation (2 tasks — serial)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T1 | server + client | contracts | `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `server/src/vendor/shared/contracts/eval-ci.ts` | — | zod, typescript-expert | **The one coordinated vendor edit (REQ-6).** Add `ContextSource = z.enum(['docs','spec','insights'])` (AC-22); extend `SpecFile` with `source: ContextSource`, `tokens: z.number().int().nullish()`, `used_by: z.number().int().nullish()`; add `ContextListing = { files: SpecFile[]; index: IndexStatus & { doc_count, refreshed_at, unavailable_reason } }`, `AttachedContextDoc = { path, source, tokens, resolved }`, `SetContextPathsBody = { paths: z.array(z.string()).max(...) }`. Extend `AgentManifest` with `context: z.array(z.string()).nullish().transform(v => v ?? [])` mirroring its `skills` normalisation (`eval-ci.ts:158-162`) — **server mirror only**. Verify: `diff server/src/vendor/shared/contracts/platform.ts client/src/vendor/shared/contracts/platform.ts` prints nothing; `cd server && pnpm exec vitest run test/contracts.test.ts && pnpm typecheck`; `cd client && pnpm typecheck` |
| T2 | server | database | `server/src/db/schema/context-docs.ts` (new), `server/src/db/schema/context.ts`, `server/src/db/schema.ts`, `server/src/db/migrations/00XX_*.sql` (generated only) | T1 | drizzle-orm-patterns, postgresql-table-design | Add `insights` to `codeChunks.source` (`context.ts:44`, now `['code','docs','spec','insights']`, values matching T1's `ContextSource` plus `code`) — AC-22. New `agent_context_docs(agent_id uuid FK→agents cascade, path text, "order" integer not null default 0, PK(agent_id, path))` and `skill_context_docs(skill_id uuid FK→skills cascade, path text, "order" integer not null default 0, PK(skill_id, path))`, modelled on `agentSkills` (`agents.ts:51-63`) — AC-8. Add a non-PK index on `path` for each (the `used_by` count query, AC-1). Re-export from `schema.ts` barrel + add to the `schema` object. **Migration produced by `pnpm db:generate`, never hand-written.** Verify: `cd server && pnpm db:generate` produces exactly one new file, `pnpm db:migrate` applies clean against a fresh volume, `pnpm typecheck` green |

### Phase 1: Server primitives (4 tasks — all parallel)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T3 | server | backend | `server/src/modules/repo-intel/pipeline/walk.ts`, `server/src/modules/repo-intel/constants.ts` | T1 | typescript-expert, onion-architecture | Parameterise `walkClone(root, opts?)` with an optional extension set and an optional per-relative-path predicate, **defaulting to today's exact behaviour** so repo-intel indexing is unchanged. Add `MARKDOWN_EXT = ['.md'] as const` and `CONTEXT_FOLDERS = ['specs','docs','insights'] as const` to `constants.ts`. Preserve `entry.isSymbolicLink()` skip (`walk.ts:89`) and the `MAX_FILE_SIZE` drop (`walk.ts:112-115`) on the new path — these are AC-20 and the symlink edge case. Verify: `cd server && pnpm exec vitest run test/indexer-walk.test.ts test/indexer-pipeline.test.ts` green **unchanged** (no test edits), `pnpm typecheck` green |
| T4 | server | backend | `server/src/modules/context/repository.ts` (new) | T2 | drizzle-orm-patterns, onion-architecture | Typed repository over the two link tables: `listAgentPaths(agentId)`, `setAgentPaths(agentId, paths[])` (replace-in-order, one transaction), same pair for skills, and `countAgentsByPath(workspaceId)` returning a `Map<path, number>` for `used_by` (AC-1). Ordered by `"order" ASC` everywhere (AC-8). No business logic here — `service.ts` is the only consumer, per the repository-pattern rule. Verify: `cd server && pnpm typecheck` green; exported function surface has no Drizzle types in its signatures |
| T5 | server | backend | `server/src/modules/context/manifest.ts` (new) | T1 | typescript-expert, security | **AC-21, CI/runner path.** Pure resolver: given a parsed `AgentManifest` and a checkout root, resolve `manifest.context` paths to document bodies, mirroring how the manifest is documented to resolve `skills` slugs to `.devdigest/skills/<slug>.md` (`eval-ci.ts:145-151`). Every read goes through `safeRepoPath` + `isWithin` (`_shared/path-safety.ts:9-21`); an unresolvable/oversized/out-of-root path is skipped and reported, never thrown (AC-14 semantics). No DB, no `Container` — a plain function so the future runner can call it. Verify: `cd server && pnpm typecheck` green; **document in the file header that no call-site exists yet in this repo** (see Recommendation 4) |
| T6 | reviewer-core | test | `reviewer-core/test/prompt-specs-injection.test.ts` (new) | — | react-testing-library *(vitest patterns only)*, typescript-expert | **NFR "untrusted handling" (AC-13).** Pin the existing behaviour: a `specs` entry containing `ignore all previous instructions` **and** a literal `</untrusted>` is rendered inside `<untrusted source="spec-0">…</untrusted>` with the close tag escaped to `<\/untrusted>` (`prompt.ts:32`), and `INJECTION_GUARD` (`prompt.ts:16-28`) is present in the system message. Also assert the `## Project context` section is **omitted** when `specs` is empty/absent (`prompt.ts:198`, backs AC-19). **No production change to `reviewer-core`.** Verify: `cd reviewer-core && npm test && npm run typecheck` green |

### Phase 2: Context service (1 task — bottleneck)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T7 | server | backend | `server/src/modules/context/service.ts` (new), `server/src/modules/context/constants.ts` (new), `server/src/modules/context/types.ts` (new), `server/src/platform/container.ts` | T1, T3, T4, T5 | onion-architecture, typescript-expert, security | The application ring. (a) `listDocuments(workspaceId, repoId)` → `ContextListing`: resolve `repos.clone_path`, walk via T3's `walkClone` filtered to `.md` under a top-level `specs`/`docs`/`insights` folder (AC-1, `.devdigest/specs/` matching as an instance of `specs/`), classify `source` from the top-level folder name (AC-22), estimate `tokens` via `this.container.tokenizer.count()` (`container.ts:136-139`) — NFR cost transparency, join `used_by` from T4. Missing/unreadable clone → an index-unavailable result naming the cause, **not** zero documents (AC-5). (b) `reindex(repoId)` re-walks from the current clone (AC-4). (c) `resolveForAgent(agentId)` → ordered deduped path list: agent-direct in stored order, then each **enabled** linked skill (reuse the `skill.enabled` filter shape from `run-executor.ts:252-253`) in `agent_skills.order` ASC, first occurrence wins (AC-15). (d) `readBodies(clonePath, paths[])` reading **fresh, uncached** (AC-12) with `safeRepoPath` + `isWithin` on every path and a per-path skip reason for unreadable/out-of-root (AC-14) — **must not use or imitate `repo-intel/service.ts:923-925`'s bare `join()`**. (e) `constants.ts` exports `CONTEXT_TOKEN_CAP` (AC-11) and reuses `MAX_FILE_SIZE` for AC-20. (f) add a lazy `get contextDocs()` facade to `container.ts`, mirroring `get repoIntel()` (`container.ts:122-125`) and overridable via `ContainerOverrides`. Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` green; `grep -n "join(" server/src/modules/context/service.ts` shows no un-contained path join |

### Phase 3: Server surfaces & injection (4 tasks — all parallel)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T8 | server | backend | `server/src/modules/context/routes.ts` (new), `server/src/modules/context/index.ts` (new), `server/src/modules/index.ts`, `.claude/skills/onion-architecture/LAYER_MAP.md` | T7 | fastify-best-practices, zod, onion-architecture | `GET /repos/:id/context` → `ContextListing` (AC-1/AC-3/AC-5/AC-20) and `POST /repos/:id/context/reindex` → `IndexStatus` (AC-4) — the two endpoints the stub hooks already target (`client/src/lib/hooks/core.ts:145-159`). Zod params/body at the boundary only, tenancy via `getContext(container, req)` like `repo-intel/routes.ts:37`, no SQL or business rules in the handler. Register `context` in the static `modules` record (`modules/index.ts:29-43`) — one import + one entry. Record the new module in `LAYER_MAP.md` (full split). Verify: `cd server && pnpm exec vitest run test/routes-smoke.test.ts --exclude '**/*.it.test.ts' && pnpm typecheck` green; `GET /repos/<id>/context` on a repo with no clone returns 200 with an unavailable reason, not an empty list |
| T9 | server | backend | `server/src/modules/agents/routes.ts`, `server/src/modules/agents/service.ts` | T7 | fastify-best-practices, zod, onion-architecture | `GET /agents/:id/context` → `AttachedContextDoc[]` (each carrying `resolved: boolean` so a stale path shows as missing rather than vanishing — AC-9) and `PUT /agents/:id/context` `{ paths: string[] }` persisting the ordered set **paths only, never bodies** (AC-6, AC-8) via `container.contextDocs`. Follow the spec's `PUT` verb (the sibling `POST /agents/:id/skills`, `routes.ts:152-165`, is set/reorder — note the deliberate difference in a comment). Workspace-scoped through the existing service `get()` guard. Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` green; `PUT` then `GET` returns the same paths in the same order |
| T10 | server | backend | `server/src/modules/skills/routes.ts`, `server/src/modules/skills/service.ts` | T7 | fastify-best-practices, zod, onion-architecture | Same as T9 for skills: `GET /skills/:id/context`, `PUT /skills/:id/context` — ordered paths only, never bodies (AC-7, AC-8), unresolved paths flagged not dropped (AC-9). Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` green; `PUT` then `GET` round-trips order |
| T11 | server | backend | `server/src/modules/reviews/run-executor.ts` | T7 | onion-architecture, typescript-expert, security | **The injection (REQ-4, REQ-5).** In `runOneAgent`, after the skills block (`run-executor.ts:251-261`): call `container.contextDocs.resolveForAgent(agent.id)` then `readBodies(...)`; pass `...(specBodies.length ? { specs: specBodies } : {})` into the `reviewPullRequest(...)` call (`:267-307`) so a zero-document agent's prompt stays byte-identical to today (AC-19, matching the existing `skills`/`repoMap` omit-when-empty pattern at `:278-283`). Replace the hard-coded `specs_read: []` at `:368` with the **actually injected** paths (AC-18); leave `:536`'s `traceFromBuffer` as `[]` (that trace is built before `assemblePrompt` ever ran). Emit one `runLog.info` per skipped/unreadable document naming the path (AC-14, NFR observability) and let the run complete. Add no new prompt-assembly path (AC-13). **Heed `server/INSIGHTS.md` 2026-08-04:** `outcome` is destructured at `:308` and TypeScript will not warn about a field you forget to read. Verify: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` green; `git diff` shows no change to `reviewer-core/**` |

### Phase 4: Client shared layer (2 tasks — parallel)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T12 | client | ui | `client/src/components/context-picker/**` (new), `client/src/lib/hooks/core.ts`, `client/messages/en/context.json` | T1, T8 | react-frontend-architecture, react-best-practices, next-best-practices | Shared, reusable attach UI + data layer used by both editors (promoted to `components/` because it has two consumers — `client/INSIGHTS.md` 2026-08-04 colocation rule). `ContextDocPicker` renders the document checklist, per-document token estimate (AC-10), a running total, an **over-cap warning with a text label, not colour alone** (AC-11 + NFR accessibility), a `map-reduce` cost-repeats note driven by a prop (AC-11), an unresolved-path row state (AC-9), and a keyboard-operable Preview drawer with visible focus. Update `useContextFiles` to the new `ContextListing` shape and keep `useReindexContext` targeting `POST /repos/:id/context/reindex` (`core.ts:145-159`). All strings through `useTranslations("context")` — extend `messages/en/context.json` (keep the existing `empty` block verbatim, it is quoted by AC-2). Server Component by default; `"use client"` only on the interactive picker. Verify: `cd client && pnpm test && pnpm typecheck` green |
| T13 | client | ui | `client/messages/en/runs.json` | — | next-best-practices | **AC-16.** Change `trace.prompt.specs` from `"Project context (dynamic)"` (`runs.json:50`) to exactly `"Project context — attached specs (untrusted)"`. AC-17 and AC-19 need **no code change** — `PromptBlock` already renders the untruncated text with copy + fullscreen, `PromptModalBody` already provides line search, and `TraceBody.tsx:96-98` already conditionally omits the block when `prompt_assembly.specs` is null. Verify: `cd client && pnpm test && pnpm typecheck` green; `grep -n "attached specs" client/messages/en/runs.json` matches |

### Phase 5: Client feature surfaces (3 tasks — all parallel)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T14 | client | ui | `client/src/app/context/**` (new), `client/src/vendor/ui/nav.ts` | T12 | react-frontend-architecture, next-best-practices, react-best-practices | The Project Context page (G-1). Lists documents with file name, folder, source category, token estimate, and "used by N agents" (AC-1); renders the **existing** empty state copy from `context.json` `empty.title`/`empty.body` when nothing is discovered (AC-2); shows the index-freshness line (AC-3); wires Re-index to refresh via TanStack Query invalidation with no full reload (AC-4); shows the index-unavailable cause when the clone is missing (AC-5). Add one `NAV` entry `{ key: "context", label: "Project Context", icon: …, href: "/context" }` to `client/src/vendor/ui/nav.ts:21-37` — **the only permitted edit in the `vendor/ui` do-not-touch tree** — so the already-present `activeKeyFor` mapping (`app-shell/helpers.ts:30`) highlights it. Verify: `cd client && pnpm test && pnpm typecheck` green; a component test asserts the empty state renders the exact `context.json` copy |
| T15 | client | ui | `client/src/app/agents/[id]/_components/AgentEditor/**`, `client/src/lib/hooks/agents.ts`, `client/messages/en/agents.json` | T12 | react-frontend-architecture, react-best-practices | Agent Editor **Context** tab (AC-6). Add `{ key: "context", labelKey: "editor.tabs.context", icon: … }` to `AgentEditor/constants.ts` `TABS` and route it in `AgentEditor.tsx:24`; new `_components/ContextTab/` renders `ContextDocPicker` with drag-to-reorder following the `SkillsTab` precedent (`SkillsTab.tsx:85-94`, `@dnd-kit`) so order is explicit (AC-8). Add `useAgentContext` / `useSetAgentContext` to `lib/hooks/agents.ts` against T9's endpoints, persisting **paths only** (AC-6). The running total is the **combined direct + enabled-linked-skill set, deduped by path** (AC-10) and carries the `map-reduce` note when `agent.strategy === "map-reduce"` (AC-11). Verify: `cd client && pnpm test && pnpm typecheck` green; a test asserts toggling a document fires one `PUT` whose body contains only `paths` |
| T16 | client | ui | `client/src/app/skills/[id]/_components/SkillEditor/**`, `client/src/lib/hooks/skills.ts`, `client/messages/en/skills.json` | T12 | react-frontend-architecture, react-best-practices | Skill Editor context section (AC-7). Add the section (new tab or a block inside `ConfigTab` — follow whichever matches the existing `SkillEditor/constants.ts` `TABS` shape most cleanly) rendering `ContextDocPicker`; `useSkillContext` / `useSetSkillContext` in `lib/hooks/skills.ts` against T10's endpoints. Running total covers **only that skill's own** attached documents (AC-10, second clause). Ordered set preserved (AC-8), unresolved paths flagged (AC-9), **paths only** persisted (AC-7). Verify: `cd client && pnpm test && pnpm typecheck` green; a test asserts the skill-level total excludes documents attached to other skills |

### Phase 6: NFR verification (4 tasks — all parallel)

Assign these to the `test-writer` agent. Each owns a distinct new file, so no
collisions with Phase 1-5 tasks.

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T17 | server | test | `server/test/context-discovery.test.ts` (new) | T3, T5, T7 | react-testing-library *(vitest patterns)*, security, typescript-expert | Hermetic unit lane (mocked adapters, temp dirs — **no DB, so not `.it.test.ts`**). Covers: 400 KB document excluded from the listing (AC-20); a symlinked `.devdigest/specs/x.md` pointing outside the repo is not discovered; `source` classified `docs`/`spec`/`insights` from the top-level folder, `.devdigest/specs/` classified `spec` (AC-22); **NFR path containment** — `../../../../etc/passwd`, `/etc/passwd`, and a backslash variant are each rejected by `safeRepoPath`/`isWithin` and produce a skip, not a throw; **NFR cost transparency** — the listed `tokens` equals `container.tokenizer.count()` for the same body via a mock tokenizer; **AC-21** — T5's manifest resolver resolves in-root paths and skips out-of-root ones. Verify: `cd server && pnpm exec vitest run test/context-discovery.test.ts && pnpm typecheck` green |
| T18 | server | test | `server/test/context-attach.it.test.ts` (new) | T8, T9, T10 | drizzle-orm-patterns, security | DB-backed lane — **`.it.test.ts` suffix is mandatory** (real Postgres via testcontainers). Covers: **NFR no body persistence** — after `PUT /agents/:id/context` and `PUT /skills/:id/context`, inspect the persisted rows and assert no column holds a document body, and that a subsequent `agent_versions.config_json` snapshot (`agents.ts:44`) carries paths only; ordered round-trip (AC-8); an attached path deleted from disk comes back `resolved: false` rather than being omitted (AC-9); **NFR list-without-bodies** — `GET /repos/:id/context` with ~50 documents returns a payload whose size scales with metadata, asserted as an upper bound far below the total document bytes; the no-clone repo returns an unavailable reason (AC-5). Verify: `cd server && pnpm exec vitest run test/context-attach.it.test.ts` green |
| T19 | server | test | `server/test/context-injection.it.test.ts` (new) | T11 | drizzle-orm-patterns, security | DB-backed lane (`.it.test.ts`). Covers: injection order = agent-direct in stored order, then enabled skills in `agent_skills.order`, deduped first-occurrence-wins when one path is reachable twice (AC-15); a **disabled** linked skill's documents are excluded; **NFR observability** — after a run with one valid and one deleted attachment, `GET /runs/:id/trace` has the valid path in `specs_read`, not the deleted one, the run log names the skipped path, and the run status is `done` (AC-14, AC-18); a zero-document agent's trace has `prompt_assembly.specs === null` and `specs_read === []` (AC-19). Verify: `cd server && pnpm exec vitest run test/context-injection.it.test.ts` green |
| T20 | client | test | `client/src/components/context-picker/ContextDocPicker.test.tsx` (new) | T12 | react-testing-library, react-best-practices | **NFR accessibility.** A keyboard-only flow with `userEvent`: tab to a document row → toggle attach → open the Preview drawer → toggle Attach/Attached → close, asserting focus is visible and reachable throughout and that the drawer traps focus with an Escape path. Assert the over-cap state exposes a **text** label (queried by accessible name/text, never by colour or class). Assert the `map-reduce` note renders when the prop is set. Verify: `cd client && pnpm test && pnpm typecheck` green |

### AC → task coverage map

All 22 acceptance criteria are covered; no orphans.

| AC | Goal | Tasks |
|---|---|---|
| AC-1 | G-1 | T1, T3, T4, T7, T8, T14 |
| AC-2 | G-1 | T12, T14 |
| AC-3 | G-1 | T1, T7, T8, T14 |
| AC-4 | G-1 | T7, T8, T12, T14 |
| AC-5 | G-1 | T7, T8, T14, T18 |
| AC-6 | G-2 | T2, T4, T9, T15, T18 |
| AC-7 | G-2 | T2, T4, T10, T16, T18 |
| AC-8 | G-2 | T2, T4, T9, T10, T15, T16, T18 |
| AC-9 | G-2 | T1, T9, T10, T12, T18 |
| AC-10 | G-3 | T7, T12, T15, T16 |
| AC-11 | G-3 | T7, T12, T15, T20 |
| AC-12 | G-4 | T7, T11 |
| AC-13 | G-4 | T11, T6 |
| AC-14 | G-4 | T5, T7, T11, T19 |
| AC-15 | G-4 | T7, T11, T19 |
| AC-16 | G-5 | T13 |
| AC-17 | G-5 | T13 *(satisfied by existing `PromptBlock`/`PromptModalBody`; verified, not rebuilt)* |
| AC-18 | G-5 | T11, T19 |
| AC-19 | G-5 | T6, T11, T13, T19 |
| AC-20 | G-1 | T3, T7, T17 |
| AC-21 | G-4 | T1, T5, T17 *(see Recommendation 4 — contract + resolver only)* |
| AC-22 | G-1 | T1, T2, T7, T17 |

## Testing Strategy

- server (fast lane): `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
- server (DB lane): `cd server && pnpm exec vitest run test/context-attach.it.test.ts test/context-injection.it.test.ts`
- client: `cd client && pnpm test && pnpm typecheck`
- reviewer-core: `cd reviewer-core && npm test && npm run typecheck`
- mcp-server: untouched — run `cd mcp-server && npm run test:unit && npm run typecheck` once as a regression guard only.
- **Any DB-backed server test MUST carry the `.it.test.ts` suffix** or the
  fast/slow split breaks. T17 is deliberately hermetic (temp dirs + mocked
  tokenizer) and therefore stays in the fast lane.
- Add a new test only where a task's Acceptance criterion requires one. T3 in
  particular must leave `test/indexer-walk.test.ts` **unedited** — that file
  passing untouched is the proof its parameterisation is behaviour-preserving.

## Risks & Mitigations

- **Vendored-mirror drift (highest risk).** Two tasks editing `vendor/shared`
  independently would silently diverge, and the mirrors are already known to
  drift. *Mitigation:* exactly one task (T1) may edit those trees, in Phase 0,
  before anything else runs; its acceptance is a `diff` proving the two
  `platform.ts` copies are byte-identical. `AgentManifest` is server-mirror-only
  and must not be copied into the client.
- **Path traversal via a stored attachment path.** The precedent already in the
  codebase (`repo-intel/service.ts:923-925`) is unguarded. *Mitigation:*
  `safeRepoPath` + `isWithin` mandated in T5 and T7, a `grep` check in T7's
  acceptance, and an explicit rejection test in T17.
- **AC-21 has no call-site.** No CI runner, `CiService`, or `export-ci` route
  exists in this repo. *Mitigation:* T5 ships a pure resolver plus a file-header
  note; Recommendation 4 offers deferral instead. Do not let an implementer
  invent a runner to satisfy the AC.
- **`run-executor` silent-drop pattern.** `outcome` is destructured at
  `run-executor.ts:308`; a field left off is computed and thrown away with no
  compiler warning (`server/INSIGHTS.md`, 2026-08-04). *Mitigation:* called out
  in T11's acceptance, plus T19 asserts `specs_read` end-to-end.
- **Prompt-baseline regression for zero-document agents.** Passing `specs: []`
  instead of omitting the key would change every existing agent's prompt.
  *Mitigation:* T11 must use the existing conditional-spread pattern
  (`run-executor.ts:278-283`); T19 asserts `prompt_assembly.specs === null`.
- **Local migration failure.** `pnpm db:migrate` can fail with "column already
  exists" against a stale Docker volume (`server/INSIGHTS.md`, 2026-08-05).
  *Mitigation:* T2 verifies against a fresh volume
  (`docker compose down -v && ./scripts/dev.sh`).
- **`vendor/ui` nav edit.** T14 touches a do-not-touch tree. *Mitigation:*
  scoped to one array entry, single owner, and `vendor/ui` has no server mirror
  to keep in sync.
- **Phase 2 is a single-task bottleneck.** T7 blocks four Phase-3 tasks. *Mitigation:*
  T7's function surface is fully specified in its row so Phase 3 tasks can be
  written against it the moment it lands; T6 and T13 have no dependency on it
  and can be started at any time to keep agents busy.

## Out of Scope

Specifications are reviewed here, not written here — the spec already exists at
`specs/2026-08-26-project-context.md` and nothing in this plan amends it.
Architecture review and security review are performed by separate reviewer
agents/skills (the `security` skill, `pr-self-review`, `architecture-reviewer`)
— not by `implementation-planner` or `implementer`.

Also explicitly out of scope, per the spec's Non-goals (REQ-8):

- The **COVERAGE** score and the Conformance Report it belongs to.
- Semantic / embedding retrieval of document chunks — this feature attaches and
  injects **whole documents by path**. The `code_chunks.embedding` column is not
  used by any task here.
- Non-markdown files.
- Any change to `reviewer-core`'s prompt structure — the `## Project context`
  section and its untrusted wrapping are used exactly as they are today.
- Document authoring/editing UI (New file / New folder / Upload / Edit / Save)
  — deferred to a follow-up spec whose canonical write target is
  `.devdigest/specs/`.
- `e2e/` coverage — plan an `agent-browser` flow as a follow-up task; it is not
  assignable to `implementer`.
