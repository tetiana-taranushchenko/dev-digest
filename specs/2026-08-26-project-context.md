# Spec: Project Context
Spec ID: SPEC-2026-08-26-project-context
Status: approved
Supersedes: —
Related: —

## Problem & user

**Who:** a developer using the DevDigest studio who has connected a repo and
configured review agents.

**Problem:** DevDigest agents today review a PR against the diff, the repo
skeleton and callers digest (`repo-intel`), linked skills, and the agent's
system prompt. They have **no access to the project's own written
intent** — PRDs, tech specs, architecture docs, incident write-ups. So an
agent cannot tell that a change violates a documented contract ("429 must
carry `Retry-After`", "callback URLs must be allow-listed"), because nobody
ever showed it the document that says so.

The plumbing for this already exists and is **unfed**:

- `reviewer-core` already accepts `specs?: string[]` (`reviewer-core/src/review/run.ts:74-75`)
  and already renders it as a `## Project context` section with every entry
  wrapped in `<untrusted source="spec-N">` (`reviewer-core/src/prompt.ts:162-165,198-200`).
- The run trace already carries `prompt_assembly.specs` and `specs_read`
  (`server/src/vendor/shared/contracts/trace.ts:43,89`), and the Run Trace
  drawer already renders both (`client/.../TraceBody/TraceBody.tsx:50-62,96-98`).
- The client already ships stub hooks and i18n copy for a Project Context page
  (`client/src/lib/hooks/core.ts:144-159`, `client/messages/en/context.json`)
  and a `SpecFile`/`IndexStatus` contract (`server/src/vendor/shared/contracts/platform.ts:257-272`).

But nothing ever populates them: `run-executor.ts` never passes `specs`
(`server/src/modules/reviews/run-executor.ts:267-307`) and hard-codes
`specs_read: []` (`run-executor.ts:368`, `:536`); `repo-intel`'s walker only
indexes code extensions and skips `.md` entirely
(`server/src/modules/repo-intel/pipeline/walk.ts:100-101`,
`server/src/modules/repo-intel/constants.ts:14`); there is no
`GET /repos/:id/context` route (`server/src/modules/index.ts:29-43`).

**This feature closes that loop:** discover the repo's markdown documents,
let a user attach chosen documents to an agent or a skill, inject them
verbatim into the run prompt, and make exactly what was injected inspectable
after the fact.

## Recommendations

Advice for the product owner to accept or reject — none of it is folded into
Goals or Acceptance criteria.

1. **Compute the token estimate on the server with the existing tokenizer,
   not `body.length / 4` in the client.** The mockup estimates client-side
   (`data_context.jsx:138`), but the server already owns a real tokenizer
   adapter — `TiktokenTokenizer` (`cl100k_base`) with `approxTokens = ceil(len/4)`
   as its documented fallback (`server/src/adapters/tokenizer/index.ts:21-40`),
   already used to budget the repo map (`server/src/modules/repo-intel/pipeline/full.ts:234`).
   Reusing it makes the number the user sees agree with the number the budget
   logic uses, and keeps the client from downloading document bodies just to
   measure them.
2. **Model the soft cap the way the repo map already models its budget.**
   `DEFAULT_REPO_MAP_TOKEN_BUDGET = 1500` (`server/src/modules/repo-intel/constants.ts:51`)
   is a named, server-owned budget constant. A `CONTEXT_TOKEN_CAP` living only
   in client UI code (as in `context_docs.jsx:11`) can't be enforced or
   reported on at run time. Consider one server-side named budget that the UI
   *reads*, so a later "truncate / warn in the run log" policy has somewhere
   to live.
3. **Consider reusing `scanForInjectionRisk` at attach time as a non-blocking
   warning.** Project docs are repo-controlled content, the same trust class
   as `imported_url`/`community` skill bodies, which are both delimiter-wrapped
   *and* pre-scanned (`server/src/modules/skills/injection-scan.ts:30-35`,
   `run-executor.ts:252-258`). The `<untrusted>` wrapper is the real defense
   and is already in place; a scan would just tell the user *before* they
   attach that a doc contains jailbreak phrasing.
4. **Consider surfacing per-slot token attribution from the data the engine
   already emits.** `PromptAssemblySummary` already reports per-section
   character counts for every real LLM call (`reviewer-core/src/prompt.ts:129-139`,
   streamed via `prompt-logging.ts:22-51`). Showing the *actual* cost of the
   project-context slot in the Run Trace would be more truthful than a
   pre-attach estimate — especially under map-reduce (see Edge cases).

## Goals / Non-goals

- **G-1:** Let a user browse every markdown context document that exists in a
  connected repo — discovered repo-wide from `specs/`, `docs/`, and
  `insights/` folders by top-level folder name — on a dedicated Project
  Context page, with the freshness of that listing and each document's
  "used by N agents" count visible.
- **G-2:** Let a user attach and detach specific documents — in an explicit
  order — to a specific agent (Agent Editor "Context" tab) or a specific
  skill (Skill Editor context section), storing only the document's path.
- **G-3:** Show a token estimate per document and for the current attachment
  set, with a soft-cap warning, so the user understands the per-run cost they
  are adding before they add it.
- **G-4:** Inject every document attached to an agent — directly or inherited
  via an attached skill — as literal text into that run's `## Project context`
  prompt block, on every review path: the studio (DB-backed) and the CI /
  GitHub-runner path (manifest-backed) alike.
- **G-5:** Make the exact injected text, and the list of document paths that
  were actually read, inspectable after the fact in the Run Trace.

**Non-goals:**

- The circular **COVERAGE** score and the Conformance Report it belongs to.
  The mockup's Project Context preview pane shows a `78` coverage badge
  (`screen_tour_context.jsx:128`); the same `78` appears as
  `CONFORMANCE.completeness` for the same spec family in
  `screen_conv_conf.jsx:90`, and the Conformance empty state says "Pick a PRD
  from **Project Context** and DevDigest checks the PR against each
  requirement" (`screen_conv_conf.jsx:123`). Coverage is that separate
  feature's output, not this one's. See Open question Q4.
- Semantic/embedding retrieval of document chunks. The `code_chunks` table has
  an `embedding` vector column and a `source` enum including `'spec'`
  (`server/src/db/schema/context.ts:31-47`), but this feature attaches and
  injects **whole documents by path**, not retrieved chunks.
- Non-markdown files.
- Changing `reviewer-core`'s prompt structure. The `## Project context` section
  and its untrusted wrapping already exist and are used as-is.
- Authoring documents from inside DevDigest (the mockup's New file / New folder
  / Upload / Edit / Save actions, `screen_tour_context.jsx:112-114,124-125`)
  — **deferred to a follow-up spec** (its own edge cases: validation,
  conflicts, writing into a cloned git working tree), not decided against.
  `.devdigest/specs/` is the folder that follow-up should treat as the
  canonical write target.

## User stories

- As a reviewer-agent author, I open **Project Context**, see the repo's specs
  and docs with a token cost next to each, and understand what grounding
  material is available before I touch an agent.
- As an agent owner, I open my Security Reviewer's **Context** tab, attach
  `specs/security-baseline.md` and `specs/public-api.md`, see "≈ 317 tokens",
  and know that's what every run of this agent will now cost extra.
- As a skill author, I attach `specs/public-api.md` to the `pr-quality-rubric`
  skill so that *every* agent using that skill inherits it, without editing
  each agent.
- As someone auditing a surprising finding, I open the run's **Run Trace →
  Prompt assembly**, click **"Project context — attached specs (untrusted)"**,
  and read the exact document text the model saw — then check **Specs read**
  in Configuration to confirm which files those were.

## Acceptance criteria (EARS)

**Browsing and discovery**

- **AC-1 (satisfies G-1):** WHEN a user opens the Project Context page for a
  connected repo, the system shall list every discovered markdown document —
  found anywhere under a repo-relative `specs/`, `docs/`, or `insights/`
  folder, `.devdigest/specs/` included as one instance of `specs/` — with its
  file name, folder, source category, estimated token count, and the number
  of agents currently attaching it ("used by N agents").
- **AC-2 (satisfies G-1):** IF the repo has no discovered markdown document,
  THEN the system shall render the existing empty state — title "No spec files
  yet", body "Drop your PRDs, tech specs, and acceptance criteria under
  `.devdigest/specs/`. Every agent and the PR brief read them as grounding
  context." (`client/messages/en/context.json:11-14`) — instead of an empty
  list.
- **AC-3 (satisfies G-1):** The system shall display an index-freshness line
  stating how many documents are indexed and when the index was last
  refreshed.
- **AC-4 (satisfies G-1):** WHEN a user triggers **Re-index**, the system
  shall re-discover markdown documents from the repo's current clone and
  refresh the displayed list without a full page reload.
- **AC-5 (satisfies G-1):** IF the repo has no clone on disk (its
  `repos.clone_path` is unset or the directory is unreadable — see
  `server/src/modules/repos/service.ts:51-58`,
  `server/src/adapters/git/simple-git.ts:37-39`), THEN the system shall report
  an index-unavailable state that names the cause, rather than reporting zero
  documents.

**Attaching**

- **AC-6 (satisfies G-2):** WHEN a user toggles a document in the Agent
  Editor's Context tab, the system shall persist only that document's
  repo-relative path against the agent, and shall never persist the document
  body (per the design's binding constraint, `data_context.jsx:3`).
- **AC-7 (satisfies G-2):** WHEN a user toggles a document in the Skill
  Editor's context section, the system shall persist only that document's
  repo-relative path against the skill, and shall never persist the document
  body.
- **AC-8 (satisfies G-2):** The system shall preserve each attachment set as
  an **ordered** list, and that stored order shall be the order the documents
  appear in the assembled `## Project context` block — matching the UI copy
  "Order matters — earlier docs appear earlier in the assembled
  `## Project context` block" (`context_docs.jsx:97-99`).
- **AC-9 (satisfies G-2):** IF an attached path no longer resolves to a file
  in the repo when an editor is opened, THEN the system shall show that
  attachment as missing/unresolved in the editor rather than omitting it from
  the list silently.

**Token estimate and soft cap**

- **AC-10 (satisfies G-3):** The system shall display an estimated token count
  for each individual document. On the Agent Editor's Context tab, the running
  total shall be the **combined** set the run will actually pay for — the
  agent's direct attachments plus every enabled linked skill's attachments,
  deduped by path (matching AC-15's injection set). On the Skill Editor's
  context section, the running total shall cover only that skill's own
  attached documents.
- **AC-11 (satisfies G-3):** WHILE the current attachment set's total token
  estimate exceeds the soft cap, the system shall display an over-cap warning
  badge and shall still permit further attachment and still permit runs to
  execute — the cap warns, it never blocks. WHEN the agent's `strategy` is
  `map-reduce`, the total shall additionally carry a note that this cost
  repeats once per changed file at run time
  (`reviewer-core/src/review/run.ts:196`), since the exact per-run cost can't
  be known until the PR's file count is.

**Injection at run time**

- **AC-12 (satisfies G-4):** WHEN an agent run starts, the system shall
  resolve every document attached to that agent — directly, plus those
  inherited from its **enabled** linked skills (`run-executor.ts:251-258`) —
  by reading that file's current content **fresh from the repo clone on
  disk, with no caching layer for document bodies** (only the path is ever
  persisted), and pass the resolved strings as `specs` to `reviewPullRequest`
  (`reviewer-core/src/review/run.ts:74-75`).
- **AC-13 (satisfies G-4):** The system shall render those documents inside
  the `## Project context` section with each document individually wrapped by
  `wrapUntrusted` (`reviewer-core/src/prompt.ts:162-165,198-200`) — i.e. this
  feature adds no new prompt-assembly path.
- **AC-14 (satisfies G-4):** IF an attached document cannot be read at run
  time (deleted, unreadable, or outside the repo root), THEN the system shall
  omit it from `## Project context`, record the omission as a run-log event,
  and complete the run — it shall not fail the run.
- **AC-15 (satisfies G-4):** The system shall include every document attached
  to the agent directly and every document attached to the agent's enabled
  linked skills in the `## Project context` block, ordered as: the agent's own
  directly-attached documents first (in their stored order), then each
  enabled linked skill's documents in turn (in `agent_skills.order` ASC, in
  each skill's own stored order). IF the same path is reachable through more
  than one route (direct and/or more than one skill), THEN the system shall
  inject it exactly once, at the earliest position it is reached.

**Run Trace visibility**

- **AC-16 (satisfies G-5):** WHEN a user expands **Prompt assembly** in the
  Run Trace of a run that injected project context, the system shall show a
  distinct block labelled exactly **"Project context — attached specs
  (untrusted)"** (`screen_trace.jsx:73`; the current label is "Project context
  (dynamic)", `client/messages/en/runs.json:50`).
- **AC-17 (satisfies G-5):** WHEN the user opens that block, the system shall
  display the complete injected text verbatim — searchable and copyable — not
  a summary or a truncation.
- **AC-18 (satisfies G-5):** The system shall record, in the run trace's
  `specs_read`, the repo-relative path of every document actually injected
  into that run (today hard-coded to `[]` at `run-executor.ts:368` and
  `run-executor.ts:536`).
- **AC-19 (satisfies G-5):** IF a run injected no project-context document,
  THEN the Run Trace shall render "none" for **Specs read**
  (`client/.../TraceBody/TraceBody.tsx:52-54`) and shall omit the
  project-context prompt block entirely (`TraceBody.tsx:96-98`, backed by
  `reviewer-core/src/prompt.ts:198`).

**Discovery limits and the CI path**

- **AC-20 (satisfies G-1):** IF a discovered markdown document exceeds 400 KB
  — the same `MAX_FILE_SIZE` limit repo-intel's walker already applies
  (`server/src/modules/repo-intel/constants.ts:43`) — THEN the system shall
  exclude it from the browse list and from both attach pickers, rather than
  offering an oversized document for attachment.
- **AC-21 (satisfies G-4):** WHEN a review runs on the CI / GitHub-runner path
  instead of the studio, the system shall resolve that agent's attached
  document paths from its `.devdigest/agents/<slug>.yaml` `AgentManifest`
  (`server/src/vendor/shared/contracts/eval-ci.ts:148-150`) — mirroring how
  that manifest already resolves `skills` slugs to
  `.devdigest/skills/<slug>.md` — rather than from the database.
- **AC-22 (satisfies G-1):** The system shall classify each discovered
  document's source category using an enum of exactly `docs` | `spec` |
  `insights` — extending the existing `code_chunks.source` enum
  (`server/src/db/schema/context.ts:44`, currently `'code' | 'docs' |
  'spec'`) with an `insights` value — determined by the document's top-level
  repo folder name.

## Edge cases

- **Map-reduce multiplies the cost.** `assemblePrompt` runs once per diff file
  in map-reduce mode (`reviewer-core/src/review/run.ts:186-197`), so the whole
  `## Project context` block is re-sent on every chunk. An agent with
  `strategy: 'map-reduce'` (`server/src/db/schema/agents.ts:20-22`) and a
  15-file PR pays the 4K soft cap **fifteen times**. The pre-attach estimate is
  a per-call figure, not a per-run figure. See Open question Q12.
- **The trace shows the whole-diff assembly, not a chunk's.** Under map-reduce,
  `assembly` is the whole-diff assembly (`run.ts:166`), overwritten only in
  single-pass (`run.ts:197`). The project-context block a user reads in the
  trace is therefore representative rather than byte-identical to any one LLM
  call. This is pre-existing behavior, not introduced here, but it becomes
  user-visible once the block is populated.
- **A document containing `</untrusted>`** is already neutralized —
  `wrapUntrusted` escapes the close tag (`reviewer-core/src/prompt.ts:32`).
- **A document containing prompt-injection text** is data, not instructions:
  `INJECTION_GUARD` is appended to every system message on every run path
  (`reviewer-core/src/prompt.ts:16-28,147`) and explicitly refuses
  scope-descoping claims in any language.
- **Path traversal via a stored path.** Attached paths are stored, then joined
  onto the clone root at read time. `repo-intel`'s existing reader does this
  with no containment check (`readClone`, `server/src/modules/repo-intel/service.ts:923-925`),
  even though `safeRepoPath`/`isWithin` exist and are used elsewhere
  (`server/src/modules/_shared/path-safety.ts:9-21`, used by
  `intent/signals.ts` and `conventions/extractor.ts`). This feature must not
  copy the unguarded pattern.
- **Symlinks.** The existing walker never follows symlinks
  (`server/src/modules/repo-intel/pipeline/walk.ts:89`), so a symlinked
  `.devdigest/specs/x.md` pointing outside the repo is not discoverable — the
  markdown discovery must keep that property.
- **Oversized document.** There is no size cap on this content today; the only
  precedent is `MAX_PR_DESCRIPTION_CHARS = 4000` on the PR body
  (`reviewer-core/src/prompt.ts:37`). A 400 KB markdown file would blow past
  any model's context window with no guard.
- **Disabled skill.** `run-executor.ts:253` filters linked skills by
  `skill.enabled`; a disabled skill's inherited documents must therefore not
  be injected, and the editors should not imply otherwise.
- **No dedicated on/off toggle.** Project context has no per-agent enable flag
  of its own, distinct from `agents.repo_intel` (which gates only the repo
  skeleton/callers digest, `run-executor.ts:234-242`). Zero attached documents
  — directly and via enabled skills — is itself the "off" state: AC-19
  already omits the block and reports "none" in that case.
- **The same document attached to two of the agent's skills** — one path,
  two inheritance routes.
- **Live edit between attach and run.** Only the path is stored, so the
  document read at run time is whatever is on disk then; a stale spec would
  make an agent reason against an outdated contract. See Open question Q3.
- **`SpecFile` is under-specified and lives in a do-not-touch tree.**
  `SpecFile` is `{ path, content?, size?, updated_at? }`
  (`server/src/vendor/shared/contracts/platform.ts:258-264`) — no `source`
  category, no `tokens`, no `used_by`, all of which the UI needs. Both mirrors
  (`server/src/vendor/shared/` and `client/src/vendor/shared/`) are flagged
  do-not-touch-without-coordination (`server/AGENTS.md:13`, `client/AGENTS.md:13`)
  and are already known to have drifted. See Open question Q8.
- **The sidebar nav is vendored.** `activeKeyFor` already maps `/context` to a
  `"context"` nav key (`client/src/components/app-shell/helpers.ts:30`), but
  `NAV` has no such item (`client/src/vendor/ui/nav.ts:21-37`) and lives under
  the do-not-touch `client/src/vendor/ui/` path.
- **Non-LLM runs.** Built-in detector runs build their trace via
  `emptyPromptAssembly` (`server/src/platform/trace-builder.ts:59-62`), which
  hard-codes `specs: null` — those runs must keep rendering no project-context
  block.
- **The CI/GitHub runner path.** `reviewer-core` is deliberately shared with a
  CI runner that has no database (`reviewer-core/src/prompt.ts:12-14`,
  `review/run.ts:23-31`). See Open question Q9.

## Workflow & communication

Three flows: **discover/browse**, **attach**, **inject + trace**. Contract
shapes only — no file or module assignments.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant WEB as client<br/>Project Context · Agent/Skill Editor · Run Trace
  participant API as server<br/>Fastify :3001
  participant FS as Repo clone<br/>~/.devdigest/workspace/&lt;owner&gt;/&lt;repo&gt;
  participant PG as Postgres
  participant ENG as reviewer-core<br/>assemblePrompt

  rect rgb(240,246,255)
  note over U,PG: 1 — Discover & browse (G-1, G-3)
  U->>WEB: Open Project Context
  WEB->>API: GET /repos/:repoId/context
  API->>FS: walk markdown docs (no symlinks, size-bounded)
  API->>PG: read/refresh index state
  API-->>WEB: [{ path, folder, source, tokens, size, updated_at, used_by }] + index status
  WEB-->>U: doc list + "Indexed: N docs · last refreshed …"
  end

  rect rgb(245,255,245)
  note over U,PG: 2 — Attach (G-2)
  U->>WEB: toggle doc in Agent "Context" tab / Skill context section
  WEB->>API: PUT /agents/:id/context  { paths: [ordered repo-relative paths] }
  Note right of API: paths only — never bodies (data_context.jsx:3)
  API->>PG: persist ordered attachment set
  API-->>WEB: persisted ordered set
  end

  rect rgb(255,250,240)
  note over U,ENG: 3 — Inject at run time + trace (G-4, G-5)
  U->>WEB: Run review
  WEB->>API: POST /pulls/:id/review
  API->>PG: agent's attached paths + enabled linked skills' paths
  API->>FS: read each path (containment-checked)
  API->>ENG: reviewPullRequest({ ..., specs: string[] })
  ENG->>ENG: "## Project context" + wrapUntrusted("spec-N", body)<br/>system += INJECTION_GUARD
  ENG-->>API: ReviewOutcome { assembly.specs, ... }
  API->>PG: run_traces.trace { prompt_assembly.specs, specs_read: [paths] }
  U->>WEB: Run Trace → Prompt assembly
  WEB->>API: GET /runs/:id/trace
  API-->>WEB: RunTrace
  WEB-->>U: "Project context — attached specs (untrusted)" → full text (searchable, copyable)
  end
```

**Contracts this feature depends on or extends** (shapes, not implementations):

| Contract | Today | This feature |
|---|---|---|
| `SpecFile` (`server/src/vendor/shared/contracts/platform.ts:258-264`) | `{ path, content?, size?, updated_at? }` | extend with `source` category, `tokens`, `used_by` — in scope for this feature's Development Plan; coordinate the edit across both `vendor/shared` mirrors in one task |
| `IndexStatus` (`platform.ts:266-272`) | `{ status, pct, message?, chunks_indexed? }` | reused for the freshness line |
| `code_chunks.source` enum (`server/src/db/schema/context.ts:44`) | `'code' \| 'docs' \| 'spec'` | extend with `'insights'` for document source categorization (AC-22) |
| `ReviewInput.specs` (`reviewer-core/src/review/run.ts:74-75`) | exists, never supplied | supplied per run, studio and CI alike |
| `PromptAssembly.specs` (`contracts/trace.ts:43`) | exists, always `null` | populated |
| `RunTrace.specs_read` (`contracts/trace.ts:89`) | exists, always `[]` | populated with injected paths |
| Agent ↔ document link | none | ordered set, precedent: `agent_skills(agent_id, skill_id, order)` (`server/src/db/schema/agents.ts:51-63`) |
| Skill ↔ document link | none | ordered set, same precedent |
| `AgentManifest` (`server/src/vendor/shared/contracts/eval-ci.ts:148-150`) | resolves `skills` slugs only | extend to also resolve attached document paths, for the CI/runner path (AC-21) |

Client → server communication uses the existing typed fetch client
(`client/src/lib/api.ts`) and TanStack Query hooks; `useContextFiles` /
`useReindexContext` already target `GET /repos/:id/context` and
`POST /repos/:id/context/reindex` (`client/src/lib/hooks/core.ts:144-159`).

## Non-functional requirements

- **Security — untrusted handling (resolved, not open).** Every injected
  document shall reach the model only inside a `<untrusted source="spec-N">`
  block, with `INJECTION_GUARD` present in the system message. This is not new
  policy — it is the existing behavior of the `specs` slot
  (`reviewer-core/src/prompt.ts:16-28,162-165,198-200`). *(verify: a
  `reviewer-core` prompt test asserting that a `specs` entry containing
  "ignore all previous instructions" and a literal `</untrusted>` appears
  inside the wrapper with the close tag escaped, and that `INJECTION_GUARD` is
  in the system message.)*
- **Security — path containment.** A stored attachment path shall never
  resolve outside the repo clone root, using the existing
  `safeRepoPath`/`isWithin` helpers rather than a bare `join()`
  (`server/src/modules/_shared/path-safety.ts:9-21`; contrast the unguarded
  `readClone`, `repo-intel/service.ts:923-925`). *(verify: unit test attaching
  `../../../../etc/passwd`, `/etc/passwd`, and a backslash variant — each
  rejected, run still completes per AC-14.)*
- **Security — no body persistence.** Agent and skill configuration shall
  store paths only; document bodies shall exist only on disk and transiently
  in an assembled prompt. *(verify: inspect the persisted rows after attaching
  a document — no column contains the body; confirm `agent_versions.config_json`
  snapshots, `server/src/db/schema/agents.ts:45`, carry paths only.)*
- **Performance — list without bodies.** Listing documents for the page and
  for the attach pickers shall not require transferring every document body to
  the client. *(verify: measure the `GET /repos/:id/context` response size with
  ~50 documents; it should scale with metadata, not total document bytes.)*
- **Observability.** Every run shall make it possible to answer "which
  documents did this run read, and what exactly did the model see" from the
  persisted trace alone — `specs_read` plus `prompt_assembly.specs` — and
  every skipped/unreadable document shall appear in the run log. *(verify:
  fetch `GET /runs/:id/trace` after a run with one valid and one deleted
  attachment; the valid path is in `specs_read`, the deleted one is not, and
  the run log names it.)*
- **Accessibility.** The attach checklist rows, the Preview drawer, and its
  Attach/Attached toggle shall be reachable and operable by keyboard alone
  with visible focus, and the token total and over-cap warning shall be
  conveyed as text, not colour alone (the mockup's warning is a red badge,
  `context_docs.jsx:105-107`). *(verify: keyboard-only walkthrough of attach →
  preview → detach; a component test asserting the over-cap state exposes a
  text label.)*
- **Cost transparency.** The token figure shown before attaching shall be
  derived from the same estimator the server uses, so the user's decision is
  based on the real number. *(verify: compare the displayed estimate against
  `approxTokens`/`TiktokenTokenizer` output for the same document,
  `server/src/adapters/tokenizer/index.ts:21-40`.)*

## Inputs and provenance

- **Document content and paths** — markdown files inside the repo clone at
  `<cloneDir>/<owner>/<repo>`, default `~/.devdigest/workspace`
  (`server/src/platform/config.ts:74-76`,
  `server/src/adapters/git/simple-git.ts:37-39`), populated by
  `git clone` from the user's connected repository
  (`server/src/modules/repos/service.ts:51-58`). Provenance: **third-party /
  repo-authored**.
- **Which documents are attached, and in what order** — chosen by the user in
  the Agent Editor Context tab or Skill Editor context section; persisted in
  DevDigest's own database. Provenance: **user-authored, first-party**.
- **Token estimates** — derived server-side from document byte content; not
  user-supplied.
- **Injected prompt text and `specs_read`** — derived at run time, persisted
  into `run_traces.trace` (`server/src/db/schema/runs.ts:36-41`).

## Untrusted inputs

All document content is **untrusted**: it comes from a cloned third-party
repository and can be authored by anyone with commit access, including a PR
author attempting prompt injection.

- **Document bodies** reach the model only inside
  `<untrusted source="spec-N">…</untrusted>`, with the close tag escaped
  (`reviewer-core/src/prompt.ts:30-34,162-165`), and `INJECTION_GUARD` in the
  system message declares everything in such blocks to be data, never
  instructions, and explicitly voids "test fixture / not for production /
  ignore this" descoping claims (`reviewer-core/src/prompt.ts:16-28`).
- **File paths and names** are attacker-influenceable strings. They are used
  to read from disk (containment check required — see NFR) and are rendered in
  the UI and in `specs_read`; they must be treated as untrusted text on both
  sides.
- **Document size** is attacker-influenceable and is an availability/cost
  vector (see Edge cases; no cap exists today).
- **What is NOT untrusted:** the user's own attach choices and ordering, and
  the agent's system prompt.

## Resolved decisions

All open questions raised during spec review were resolved by the product
owner on 2026-08-26; each decision is folded into the requirements above.
Kept here as a short decision log:

- **Q1 — discovery scope:** repo-wide across `specs/` / `docs/` / `insights/`
  folders (AC-1); `.devdigest/specs/` is the future authoring target (Q10),
  not the only discovery folder.
- **Q2 — merge order/dedup:** agent-direct docs first, then enabled skills in
  `agent_skills.order`, deduped by path, first occurrence wins (AC-15).
- **Q3 — freshness:** resolved fresh from the repo clone on every run; no
  caching of document bodies (AC-12).
- **Q4 — scope of "used by" / COVERAGE:** "used by N agents" is in scope
  (AC-1); the COVERAGE score stays out, owned by the future Conformance
  Report feature (Non-goals).
- **Q5 — soft-cap total:** the agent-level total is the combined, deduped
  direct + inherited set; the skill-level total is that skill's own set only
  (AC-10).
- **Q6 — toggle:** no new on/off flag; zero attached documents (direct +
  inherited) is itself the "off" state, distinct from `agents.repo_intel`
  (Edge cases).
- **Q7 — size cap:** reuse the existing `MAX_FILE_SIZE = 400 KB` repo-intel
  convention at discovery time (AC-20).
- **Q8 — vendored-contract coordination:** in scope for this feature; the
  Development Plan owns extending both `vendor/shared` mirrors in one
  coordinated task (Contracts table).
- **Q9 — CI/runner path:** in scope, via the existing `AgentManifest`
  (`.devdigest/agents/<slug>.yaml`) convention, mirroring skill resolution
  (AC-21).
- **Q10 — document authoring:** deferred to a follow-up spec, not decided
  against (Non-goals).
- **Q11 — source categories:** `docs` | `spec` | `insights`, extending the
  existing `code_chunks.source` enum, determined by top-level folder name
  (AC-22).
- **Q12 — map-reduce cost:** the UI adds a note that the cost repeats per
  changed file under `map-reduce`, without predicting an exact multiplier
  (AC-11).
