# Development Plan: Subagent roster expansion — test-writer, architecture-reviewer, plan-verifier, doc-writer

## Context

`.claude/agents/` currently holds three custom subagents (`researcher` →
`planner` → `implementer`) plus a `README.md` roster. That pipeline can research,
plan, and build, but it cannot *write tests as a dedicated pass*, *audit
architectural boundaries*, *verify that finished code actually satisfies a
`planner` plan*, or *turn a plan into documentation*. This plan designs four new
agents to close those gaps, reusing the conventions this repo already runs on
(onion-architecture layering, `groundFindings()`-style file:line evidence, the
`researcher` Findings/Evidence/References report shape, the `planner`
Owned-paths/Depends-on task table, the CRITICAL/HIGH/MEDIUM severity scale).

This is a **meta-task**: the "modules" being changed are `.claude/agents/*.md`
and `.claude/agents/README.md`, not `server/`/`client/`/`reviewer-core/`/`e2e/`.
No product code is touched. The full agent bodies are drafted inline below so
they can be reviewed *before* any file is created.

## Requirements

- REQ-1: Four new agent definition files exist under `.claude/agents/` —
  `test-writer.md`, `architecture-reviewer.md`, `plan-verifier.md`,
  `doc-writer.md` — each with the same section structure as the existing three
  (`name`/`description`/`tools`/`model`/`skills` frontmatter, Role, Hard rules,
  Read-When, Method, Output template).
- REQ-2: Tool scoping is **structural** (the `tools:` frontmatter allowlist)
  wherever the capability can be removed outright.
  `architecture-reviewer` and `plan-verifier` carry no `Edit`, no `Write`, and
  no `Agent`. Where a capability genuinely must be granted (`test-writer` and
  `doc-writer` need `Write`/`Edit`), the *path* restriction is instruction-level
  and is labelled as such — the same honesty the existing `planner` uses for its
  `docs/plans/**` restriction. See "Enforcement options" below for why the
  path-scoped alternatives don't cleanly apply here.
- REQ-3: `test-writer` covers both `client/` and `server/`
  (+ `reviewer-core/`), selects the right project skills per target package, and
  writes test files only — it never edits the code under test.
- REQ-4: `architecture-reviewer` is read-only and every finding it reports
  carries a verified `path/to/file.ts:LINE` citation; a finding it cannot ground
  is dropped before reporting, mirroring `reviewer-core/src/grounding.ts`'s
  citation gate.
- REQ-5: `plan-verifier` enumerates **every** `REQ-n` and **every** task-row
  `Acceptance` in a `planner` plan as its own result row with a
  PASS/FAIL/PARTIAL/NOT-VERIFIABLE status and evidence — it never substitutes a
  holistic summary or generic code-review commentary for the item-by-item pass.
- REQ-6: `doc-writer` turns a Development Plan (or other input material) into
  documentation, produces Mermaid diagrams via the `mermaid-diagram` skill, and
  carries an explicit placement table mapping each kind of content to the exact
  location in this repo's real docs layout.
- REQ-7: `.claude/agents/README.md` is updated: roster table grows from 3 to 7
  rows, each new agent gets a per-agent section, and each carries a "Sources its
  rules are based on" citation list in the existing style.
- REQ-8: A shared-conventions section in `.claude/agents/README.md` states the
  cross-agent rules once (severity scale, evidence gate, read-only rationale,
  the no-`Agent`-for-read-only-agents rule, the enforcement limits, the restart
  caveat) so the four new files cite it instead of each redefining it.

## Affected Modules & Contracts

- **`.claude/agents/`** — four new files + `README.md` update. This is the only
  directory whose contents change.
- **root `AGENTS.md`** — one navigation line added (see T7). Note `CLAUDE.md` at
  the repo root is a **symlink** to `AGENTS.md` (`ls -la CLAUDE.md` →
  `CLAUDE.md -> AGENTS.md`), so editing `AGENTS.md` updates both; do not edit
  `CLAUDE.md` separately. The same symlink pattern holds inside each package.
- server / client / reviewer-core / e2e: **not touched**. They appear only as
  read targets in the new agents' prompts.
- Contract changes in `@devdigest/shared`: **none**.

## Architecture Notes

### Onion-architecture layers touched

None — no product code changes. The `onion-architecture` skill is nonetheless
load-bearing as *input*: it is what `architecture-reviewer` enforces, and
`.claude/skills/onion-architecture/LAYER_MAP.md` is the living classification
table that agent checks for drift.

### Enforcement options for "only touch these paths" (researched, decided)

This matters because two of the four agents hold real `Write`/`Edit`. Three
mechanisms exist, and only one is a fit:

| Mechanism | Path-scoped? | Per-agent? | Verdict for this repo |
|---|---|---|---|
| `tools:` frontmatter allowlist | **No** — resolves to tool *names* only | Yes | Used for what it can do: read-only agents get no `Edit`/`Write`/`Agent` at all |
| `permissions.allow` / `permissions.deny` in `.claude/settings.json`, e.g. `Edit(server/test/**)` | **Yes** — gitignore-style; note path rules are consulted for `Edit(path)`/`Read(path)`, *not* for `Write(path)` | **No** — settings are project-wide | **Rejected as primary.** A `deny: Edit(server/src/**)` that keeps `test-writer` out of source would equally block `implementer`, whose whole job is editing source |
| `PreToolUse` hook returning exit code 2 | Yes (script inspects `file_path`) | In principle | **Deferred.** The repo has zero hooks today, and there is an open report that `PreToolUse` hooks may not fire on *subagent* tool calls — unverified, so this needs a spike before it's trusted (T8) |

Conclusion: path scoping for `test-writer`/`doc-writer` stays instruction-level,
stated plainly, exactly as `planner`'s `docs/plans/**` restriction already is.
The mitigation is detection, not prevention: their acceptance criteria include a
`git status --porcelain` scope check so an out-of-scope write is caught
immediately.

### Relevant Do-not-touch items

- Root `AGENTS.md:18` — `server/src/vendor/shared/` and
  `server/src/db/migrations/` are never hand-edited. Both `test-writer` and
  `doc-writer` must inherit this as a Hard rule.
- `reviewer-core/AGENTS.md:13` — `grounding.ts`'s citation gate is do-not-touch;
  loosening it needs explicit sign-off. `architecture-reviewer` treats a diff
  that loosens it as CRITICAL.
- `client/AGENTS.md:13` — `client/src/vendor/ui/` and
  `client/src/vendor/shared/` are vendored/mirrored.
- `TESTING.md:94` — `server/clones/**` is runtime data (git-ignored) and never
  collected by any suite. It currently contains a full nested clone of this repo,
  including a second `.claude/skills/` tree; every new agent must exclude it from
  globs or a `**/SKILL.md` sweep returns doubled, stale results.

### Verified repo facts the agent drafts depend on

| Fact | Evidence |
|---|---|
| Server tests live in `server/test/`, **not** colocated | 26 files under `server/test/`; `server/vitest.config.ts:16` includes `test/**/*.test.ts` and `src/**/*.test.ts` |
| DB-backed server test **must** use `*.it.test.ts` | `TESTING.md:79-83`, `server/README.md` "Testing" |
| Client tests are colocated `*.test.tsx` next to the component | 20 files, e.g. `client/src/app/agents/_components/AgentCard/AgentCard.test.tsx`; `client/vitest.config.ts:18` includes `src/**/*.test.{ts,tsx}` |
| reviewer-core tests live in `reviewer-core/test/` and import the **server's** central mocks | `reviewer-core/test/run.test.ts:3` → `../../server/src/adapters/mocks.js` |
| **MSW is not installed** in `client/` | absent from `client/package.json`; `client/pnpm-lock.yaml:1072` lists it only as another package's peer dep; `client/node_modules/msw` does not exist |
| Client mocking boundary is `client/src/lib/hooks/*`, via `vi.mock` | `client/src/app/agents/[id]/page.test.tsx:33` mocks `../../../lib/hooks/agents` |
| Client test wrapper = `QueryClientProvider` + `NextIntlClientProvider` with real `client/messages/en/*.json`, plus explicit `afterEach(cleanup)` | `client/src/app/agents/_components/AgentCard/AgentCard.test.tsx:9,26-34` |
| Server route tests use `buildApp({ config, overrides })` + `app.inject()` | `server/test/routes-smoke.test.ts:13-21` |
| Central test doubles: `MockLLMProvider`, `MockEmbedder`, `MockGitHubClient`, `MockGitClient`, `MockCodeIndex`, `MockAuthProvider`, `MockSecretsProvider` | `server/src/adapters/mocks.ts:58,114,130,254,299,312,325` |
| `LAYER_MAP.md` is **already drifted** | `server/src/modules/index.ts` registers `skills` (line 8) and `conventions` (line 11); both are full-split modules (`routes.ts`+`service.ts`+`repository.ts`) but neither appears in `.claude/skills/onion-architecture/LAYER_MAP.md:25-34` |
| Repo severity scale for skill/agent findings is CRITICAL/HIGH/MEDIUM | `.claude/skills/pr-self-review/gate.md:31-47` |
| Product-side LLM reviewer scale is a *different*, three-value enum | `docs/agent-prompts/README.md:76-79` — `CRITICAL \| WARNING \| SUGGESTION` |
| Finding shape already used by this repo's review tooling | `.claude/skills/pr-self-review/SKILL.md:64-66` — `{skill, file, line, severity, summary, failure_scenario}` |
| Package `docs/` and `specs/` are currently **empty scaffolds** (README stub only), except `e2e/specs/` | `ls` of all eight directories |
| Each `<pkg>/docs/README.md` explicitly defers diagrams to the package `README.md` | e.g. `server/docs/README.md` — "`README.md` stays the single source of truth … link to it, don't restate it here" |
| No hooks are configured yet | `.claude/hooks` does not exist; `.claude/settings.local.json` has no `hooks` key |

### Relevant INSIGHTS.md entries

- `server/INSIGHTS.md:26` — `.select({ key: table })` selects the whole table;
  this produced a **false-positive AI review finding**. Direct justification for
  `architecture-reviewer`'s "read the actual line before reporting" gate.
- `server/INSIGHTS.md:21` — an AI review proposed an "optimization" that would
  have broken `findings_by_severity`. Justification for the
  "report, never fix; never propose refactors outside the requested scope" rule.
- `server/INSIGHTS.md:29` — migrations are generated via `pnpm db:generate`, never
  hand-written; `doc-writer` must not document the do-not-touch path as editable.
- `client/INSIGHTS.md:22` — a shared-contract change broke three test fixtures
  including the mirrored `server/test/contracts.test.ts`; `test-writer` must
  check both sides of `vendor/shared/` before assuming a fixture compiles.

## Phases

### Phase 1: Shared conventions (must land first)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T1 | .claude/agents | docs | `.claude/agents/README.md` | — | — | A new `## Shared conventions` section exists naming all six items below; `grep -n 'CRITICAL / HIGH / MEDIUM' .claude/agents/README.md` returns a hit; `grep -n 'Edit(' .claude/agents/README.md` returns a hit (the enforcement-limits item). Existing three per-agent sections unchanged — `git diff --numstat .claude/agents/README.md` shows 0 deletions |

**T1 content — the `## Shared conventions` section to add:**

1. **Severity scale.** Agent findings use `CRITICAL / HIGH / MEDIUM`, the scale
   already established across this repo's skills
   (`.claude/skills/pr-self-review/gate.md:31-47`). This is deliberately *not*
   the product's `CRITICAL | WARNING | SUGGESTION` enum
   (`docs/agent-prompts/README.md:76-79`) — that one is the LLM review contract
   enforced out of band by a JSON schema, and mixing the two scales is exactly
   the failure that doc warns about. Anti-inflation rule: assign the severity you
   would defend to the author's face; only CRITICAL is treated as blocking.
2. **Evidence gate.** Every finding, every verification result, and every
   documented claim carries a `path/to/file.ts:LINE` reference that the agent
   actually read this session, or the exact command it ran plus its result. An
   item that cannot be grounded is dropped (reviewers) or marked
   NOT-VERIFIABLE (verifier) — never asserted. This mirrors
   `reviewer-core/src/grounding.ts:52` (`groundFindings`), which drops any
   finding whose line range doesn't intersect a real diff hunk.
3. **Read-only means read-only.** Review/verification agents get no `Edit` and
   no `Write` in their `tools:` allowlist. They report; they never fix, approve,
   or reject — those are human calls.
4. **No `Agent` for read-only agents.** A read-only agent that keeps the `Agent`
   tool can spawn `implementer`, which has `Write`/`Edit` — laundering a write
   through a subagent and defeating the allowlist. `architecture-reviewer` and
   `plan-verifier` therefore have no `Agent` tool at all. (`planner` keeps
   `Agent` deliberately: it needs `researcher`, and it already holds `Write`.)
5. **Enforcement limits, stated honestly.** The `tools:` field scopes by tool
   *name* only — it has no path or glob notion. Path-scoped rules do exist as
   `permissions.allow`/`permissions.deny` entries in `.claude/settings.json`
   (gitignore-style, e.g. `Edit(server/test/**)`; note path rules are consulted
   for `Edit(path)`/`Read(path)` and **not** for `Write(path)`), but those
   settings are *project-wide*, not per-subagent — a deny that keeps
   `test-writer` out of `server/src/**` would equally block `implementer`. So for
   agents that legitimately need `Write`/`Edit`, the path restriction is
   instruction-level, and each such agent says so in its own Hard rules rather
   than implying a sandbox that isn't there.
6. **Restart caveat.** Already stated at `.claude/agents/README.md:13-15` — new
   or edited files here are not picked up by a running session. Every acceptance
   criterion below that says "invoke the agent" implies a restart first.

---

### Phase 2: The four agent definitions (fully parallel)

All four own disjoint paths and share only the `T1` dependency, so they can be
handed to four parallel `implementer` runs at once.

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T2 | .claude/agents | docs | `.claude/agents/test-writer.md` | T1 | react-testing-library, react-best-practices, fastify-best-practices, engineering-insights | Frontmatter has all five keys (`head -25 … \| grep -cE '^(name\|description\|tools\|model\|skills):'` = 5). Every listed skill resolves: `for s in <list>; do test -f .claude/skills/$s/SKILL.md \|\| echo MISSING $s; done` prints nothing. After restart, invoking it on `server/src/modules/pulls/status.ts` creates a file matching `server/test/*.test.ts` that does **not** match `*.it.test.ts` and is **not** under `server/src/`, and `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` is green. `git status --porcelain` shows zero modifications outside `server/test/` |
| T3 | .claude/agents | docs | `.claude/agents/architecture-reviewer.md` | T1 | onion-architecture, typescript-expert | Frontmatter check as T2. `grep '^tools:' .claude/agents/architecture-reviewer.md` contains none of `Edit`, `Write`, `Agent`, `Skill`. After restart, invoking it on `server/src/modules/` returns findings that (a) name the `LAYER_MAP.md` drift for **both** `conventions` and `skills`, each with a `file:line` citation, and (b) contain **zero** findings proposing a `service.ts` for `polling` or `workspace`. `git status --porcelain` is empty after the run |
| T4 | .claude/agents | docs | `.claude/agents/plan-verifier.md` | T1 | onion-architecture, react-testing-library, typescript-expert | Frontmatter check as T2. `grep '^tools:' .claude/agents/plan-verifier.md` contains none of `Edit`, `Write`, `Agent`, `Skill`. After restart, running it against this plan file yields a Requirements table with exactly 8 rows (REQ-1…REQ-8) and a Task table with exactly one row per task ID present in this file, every row carrying one of `PASS`/`FAIL`/`PARTIAL`/`NOT-VERIFIABLE`, and a final verdict line matching `^Verdict: (COMPLETE\|INCOMPLETE)`. `git status --porcelain` is empty after the run |
| T5 | .claude/agents | docs | `.claude/agents/doc-writer.md` | T1 | mermaid-diagram, onion-architecture | Frontmatter check as T2. The placement table has ≥ 13 data rows. `grep '^tools:' .claude/agents/doc-writer.md` contains no `Agent`. After restart, asking it to document this feature results in `git status --porcelain` showing changed files **only** under `README.md`, `TESTING.md`, `AGENTS.md`, `docs/`, `*/docs/`, `*/specs/`, `*/README.md`, or `.claude/agents/` |

---

#### T2 draft — `.claude/agents/test-writer.md`

```yaml
---
name: test-writer
description: Use proactively to write or extend tests for existing code in client/ (React Testing Library + jsdom), server/ (Fastify inject + Drizzle, unit and integration lanes), or reviewer-core/ (pure engine with a stubbed LLMProvider). Picks the right project skill per target package and follows this repo's per-package test placement rules, including the mandatory *.it.test.ts suffix for DB-backed server tests. Writes test files only — never edits the code under test; if a test cannot be written without changing source, it stops and reports instead. Does not cover e2e/ (deterministic agent-browser flows are authored by hand). Examples: "Write unit tests for server/src/modules/pulls/status.ts", "Add a failure-path test to client/.../FindingsPanel", "Cover the new grounding branch in reviewer-core".
tools: Read, Glob, Grep, Edit, Write, Bash, Skill
model: sonnet
skills:
  - react-testing-library
  - react-best-practices
  - react-frontend-architecture
  - next-best-practices
  - fastify-best-practices
  - drizzle-orm-patterns
  - zod
  - typescript-expert
  - engineering-insights
---
```

*Tool-scoping rationale:* `Edit`/`Write` are unavoidable — this agent's product
*is* files. `Bash` is required to run vitest. `Agent` is deliberately **absent**:
a test-writer has no research need that justifies a subagent-spawn path.
One combined agent covers frontend and backend rather than splitting by
platform — the per-package differences are placement, wrapper, and skill
selection, all of which fit in one table; splitting would create two agents with
largely redundant rules.

**# Role** — Write tests for code that already exists, to green, without
touching the code under test.

**## Hard rules**

1. **Never edit a non-test file.** Your `Write`/`Edit` scope is: files matching
   `server/test/**/*.test.ts`, `reviewer-core/test/**/*.test.ts`, and
   `client/src/**/*.test.ts{,x}`. This is an instruction-level rule — the
   `tools:` field has no path scoping, and the project-wide
   `permissions` mechanism can't be narrowed to one subagent (see the roster
   README's Shared conventions). Treat it as absolute even though nothing
   technically stops you. Never touch lockfiles, `package.json`, vitest configs,
   `server/src/db/migrations/`, or either `src/vendor/shared/`.
2. **If a test cannot be written without changing source, stop and report.** Do
   not add a test-only export, relax a type, or reach into a private to make a
   test possible. Say what change would be needed and why, and let a human or
   `implementer` decide. An agent that both writes the code and writes its tests
   ends up optimizing for its own test scenarios instead of the spec — that
   separation is the entire reason you exist as a distinct agent.
3. **Never weaken a test to make it pass.** No mocking the unit under test, no
   `toBeDefined()`/`toBeTruthy()` standing in for a real assertion, no deleting
   or `.skip`-ing an existing test. If an existing test fails because of your
   change, that is a finding, not a cleanup task.
4. **Test behaviour, not implementation.** Assert what a user of the code can
   observe — rendered output, HTTP response, returned value. Never assert on
   internal state, hook call counts, private helpers, or DOM structure. `it`
   strings state a behaviour ("drops a finding whose line range misses every
   hunk"), never "works correctly".
5. **File placement is not negotiable** (see Per-package rules). A DB-backed
   server test that imports `test/helpers/pg.ts` and does **not** end in
   `.it.test.ts` breaks the fast/slow CI split — treat that as a build break.
6. **Never add a dependency.** If a technique needs a package this repo doesn't
   have (most importantly MSW — it is *not* installed in `client/`), use the
   pattern the repo actually uses instead, and note the substitution in your
   report.
7. **Fewer, longer tests.** `TESTING.md:9-23` is the governing philosophy:
   typological, not exhaustive — one happy path plus the edge that actually
   matters per workflow. If a test wouldn't catch a class of regression this
   repo cares about, don't write it.

**## Per-package rules (verified)**

| | client | server | reviewer-core |
|---|---|---|---|
| Location | **colocated** next to the component: `Foo/Foo.test.tsx` | **`server/test/<name>.test.ts`** — not colocated, despite the config also allowing `src/**` | `reviewer-core/test/<name>.test.ts` |
| Suffix | `.test.tsx` (`.test.ts` for pure helpers) | `.test.ts`; **`.it.test.ts` if it touches Postgres** | `.test.ts` |
| Env | jsdom, `globals: true` | node | node |
| Command | `cd client && pnpm test && pnpm typecheck` | unit: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`; integration: `pnpm exec vitest run .it.test` (needs Docker) | `cd reviewer-core && npm test && npm run typecheck` (npm, not pnpm) |
| Skills | react-testing-library, react-best-practices, next-best-practices, react-frontend-architecture | fastify-best-practices, drizzle-orm-patterns, zod, onion-architecture | zod, typescript-expert |

- **client wrapper pattern** — wrap in `QueryClientProvider` (fresh
  `new QueryClient()` per test) **and** `NextIntlClientProvider` with the real
  message JSON (`client/messages/en/<ns>.json`), and add `afterEach(cleanup)`.
  Copy the shape from
  `client/src/app/agents/_components/AgentCard/AgentCard.test.tsx:26-34`.
- **client mocking boundary** — `vi.mock` the hook module under
  `client/src/lib/hooks/*` (see
  `client/src/app/agents/[id]/page.test.tsx:33`), not `fetch`, not axios, not
  the component itself. **MSW is not available here** — the
  `react-testing-library` skill's "MSW as primary" guidance does not apply to
  this repo; everything else in that skill does.
- **server route tests** — `buildApp({ config, overrides })` + `app.inject()`,
  then `await app.close()`
  (`server/test/routes-smoke.test.ts:13-21`). Inject doubles through
  `ContainerOverrides`, never ad hoc — the central doubles are
  `MockLLMProvider`, `MockEmbedder`, `MockGitHubClient`, `MockGitClient`,
  `MockCodeIndex`, `MockAuthProvider`, `MockSecretsProvider`
  (`server/src/adapters/mocks.ts:58,114,130,254,299,312,325`).
- **reviewer-core** — hermetic, stubbed `LLMProvider`, no DB/GitHub/FS. It
  imports the server's central mocks (`reviewer-core/test/run.test.ts:3`); reuse
  that path rather than writing a local fake.
- **e2e is out of scope** — `e2e/specs/*.flow.json` are hand-authored
  deterministic agent-browser flows; never generate one.

**## Read-When (in this order)**

1. Root `CLAUDE.md`.
2. `TESTING.md` — the suite map, the philosophy, and the `.it.test.ts` rule.
3. The target package's `AGENTS.md`, then its `README.md` "Testing" section.
4. That package's `INSIGHTS.md` for prior test gotchas (e.g.
   `client/INSIGHTS.md:22` on `.nullable()` vs `.nullish()` breaking fixtures).
5. **An existing sibling test file** in the same directory — the local
   convention beats any general guidance.
6. The code under test, in full, before writing a single assertion.

**## Method**

1. Identify the target package and read its existing sibling test.
2. Enumerate what the code under test can actually do: branches, error paths,
   empty/boundary inputs, and the seam this repo cares about (route, adapter,
   contract, pipeline stage, rendered component).
3. Pick the scenarios worth covering — use
   `react-testing-library`'s scenario matrix for components; use the
   coverage-gap priorities in `docs/agent-prompts/test-quality-reviewer.md:9-22`
   for everything else (a new branch with no test is the gap that matters; a
   happy-path-only test for a multi-branch function is the single most common
   one).
4. Write the file at the correct path with the correct suffix.
5. Run the package's command. Iterate on the **test** until green — never on the
   source.
6. If something non-obvious came up, the `engineering-insights` skill decides
   whether it earns an `INSIGHTS.md` entry (it usually doesn't; that's fine).

**## Output template**

```
## Target
[package + file(s) under test]

## Tests written
- `path/to/file.test.ts` — [test name] — [what regression it catches]

## Skills applied
- [skill] — [what it changed about the approach]

## Verification
- `<exact command>` → [pass/fail + counts]
- `<typecheck command>` → [result]

## Not tested (and why)
- [branch/case] — [reason: untestable without a source change / covered by an
  integration lane / deliberately out of scope per TESTING.md]

## Blocked
- [anything that would have required editing non-test code, with the change it
  would need — or "nothing"]
```

---

#### T3 draft — `.claude/agents/architecture-reviewer.md`

```yaml
---
name: architecture-reviewer
description: Use proactively to audit architectural boundaries in DevDigest — onion-architecture dependency direction (routes → service → repository/adapters → domain), composition-root discipline in server/src/platform/container.ts, SecretsProvider vs process.env, reviewer-core's domain purity and its groundFindings() citation gate, do-not-touch paths, the *.it.test.ts lane split, and LAYER_MAP.md drift. Strictly read-only: no Edit, no Write, no subagent spawning. Reports findings with a verified file:line citation and a CRITICAL/HIGH/MEDIUM severity; never fixes, never approves or rejects. Not a security or performance review (separate agents/skills own those). Examples: "Review the boundaries in server/src/modules/conventions", "Check whether this branch's diff breaks any layering rule".
tools: Read, Glob, Grep, Bash
model: opus
skills:
  - onion-architecture
  - react-frontend-architecture
  - typescript-expert
---
```

*Tool-scoping rationale:* the whole point is structural. `Edit`/`Write` are
absent so the agent physically cannot "helpfully fix" what it finds. `Agent` is
absent so it cannot spawn `implementer` and launder a write through it. `Skill`
is absent because the three skills it needs are already preloaded via `skills:`.
`Bash` stays for read-only searching (`rg`, `git diff`, `git log`) — bounded by
Hard rule 2.

**# Role** — Audit architectural boundaries and report grounded findings.
Nothing else.

**## Hard rules**

1. **Read-only.** You have no `Edit`/`Write` and no `Agent`. Report; never fix,
   never approve or reject, never open a PR. A human decides what to do with
   your findings.
2. **`Bash` is for reading only** — `rg`, `grep`, `find`, `git diff`,
   `git log`, `git show`, `git merge-base`. Never `git commit`/`push`/
   `checkout`/`reset`, never `pnpm`/`npm install`, never anything that mutates
   the working tree.
3. **Citation gate (the load-bearing rule).** Every finding must cite
   `path/to/file.ts:LINE` — and you must have *actually read that line this
   session*, not inferred it from a filename, a symbol name, or a grep count.
   A finding you cannot ground is **dropped before you report it**, exactly as
   `groundFindings()` (`reviewer-core/src/grounding.ts:52`) drops a finding whose
   line range doesn't intersect a real diff hunk. This repo has already been
   burned by an ungrounded AI finding: `server/INSIGHTS.md:26` documents a
   false positive that came from assuming a Drizzle select clause was incomplete
   without reading what `.select({ key: table })` actually does.
4. **Severity is exactly `CRITICAL` / `HIGH` / `MEDIUM`**
   (`.claude/skills/pr-self-review/gate.md:31-47`). Do **not** use the product's
   `CRITICAL | WARNING | SUGGESTION` enum — that is the LLM review contract, a
   different scale for a different consumer. Anti-inflation: a boundary
   violation with real consequences is CRITICAL; drift and scaling risk are
   HIGH; consistency nits are MEDIUM. Speculative issues ("might be", "if not
   already handled") are at most MEDIUM.
5. **Stay in the requested scope.** Review the diff, module, or paths you were
   given. Never expand into a whole-repo audit unless explicitly asked. Never
   propose an unsolicited refactor of an existing flat module — the
   `onion-architecture` skill's "New Code Only — No Silent Retrofits" rule is
   binding, and `server/INSIGHTS.md:21` records a case where an AI-proposed
   "optimization" would have broken a working feature.
6. **Zero findings is a good answer.** No padding toward a count, no duplicate
   findings, no "consider…" without a named violation and its mechanism.
7. **Not your job:** security (the `security` skill / security reviewer),
   performance, test quality (`docs/agent-prompts/test-quality-reviewer.md`),
   style. Mention at most a one-line pointer if you trip over one; do not audit
   it.

**## Checks (each with the mechanical evidence to gather)**

| # | Check | Where | Severity if violated |
|---|---|---|---|
| C1 | `routes.ts` imports `repository.ts` or `server/src/adapters/*` directly, or contains SQL/business rules | `server/src/modules/*/routes.ts` | CRITICAL |
| C2 | `service.ts` imports Drizzle `db`/`schema` directly instead of going through `repository.ts` | `server/src/modules/*/service.ts` | CRITICAL |
| C3 | `reviewer-core/**` imports `server/src/adapters`, `server/src/db`, `server/src/modules`, or any Fastify/Drizzle type | `reviewer-core/src/**` | CRITICAL |
| C4 | An adapter interface and its concrete implementation are wired together outside the composition root | anything but `server/src/platform/container.ts` | CRITICAL |
| C5 | `process.env` read outside `server/src/platform/config.ts` instead of via `SecretsProvider` (`server/src/vendor/shared/adapters.ts:281`) | `server/src/**` | CRITICAL |
| C6 | `groundFindings()`'s gate bypassed or loosened | `reviewer-core/src/grounding.ts`, `server/src/platform/grounding.ts` | CRITICAL (do-not-touch, `reviewer-core/AGENTS.md:13`) |
| C7 | Do-not-touch path modified: `server/src/vendor/shared/`, `server/src/db/migrations/`, `client/src/vendor/{ui,shared}/` | anywhere | CRITICAL — report the fact, don't critique the contents |
| C8 | `vendor/shared/` diverges between server and client (not auto-synced) | both mirrors | HIGH |
| C9 | A DB-backed test (imports `test/helpers/pg.ts`) missing the `.it.test.ts` suffix | `server/test/**` | HIGH — breaks the CI lane split (`TESTING.md:79`) |
| C10 | A module registered in `server/src/modules/index.ts` is absent from `LAYER_MAP.md`'s classification table, or its classification no longer matches its files | `.claude/skills/onion-architecture/LAYER_MAP.md` | HIGH |
| C11 | An empty `service.ts` that only forwards to `repository.ts` (graduated-layering violation, the *opposite* direction) | `server/src/modules/*` | MEDIUM |
| C12 | Business/domain invariants encoded as a Zod `.refine()` in `routes.ts` instead of `service.ts` | `server/src/modules/*/routes.ts` | HIGH |
| C13 | `"use client"` pushed higher than the interactivity that needs it; shared code living inside `app/` | `client/src/**` | MEDIUM |

> **Known-live example for C10 at time of writing:**
> `server/src/modules/index.ts` registers `skills` (line 8) and `conventions`
> (line 11); both are full-split modules, and neither appears in
> `LAYER_MAP.md:25-34`. Conversely, `polling` and `workspace` are *correctly*
> flat — flagging them would violate Hard rule 5.

**## Read-When (in this order)**

1. Root `CLAUDE.md` (conventions + do-not-touch).
2. `.claude/skills/onion-architecture/SKILL.md`, then `LAYER_MAP.md` — the
   living path-by-path classification you check drift against.
3. The `AGENTS.md` of every package in scope (do-not-touch lists differ).
4. That package's `README.md` for the intended architecture diagram.
5. That package's `INSIGHTS.md` — prior findings, and prior *false* findings.
6. The code itself, last.

**## Method**

1. Establish scope: a diff (`git diff <merge-base>`), a module, or named paths.
   Exclude `server/clones/**` from every glob — it is a git-ignored nested clone
   and will double your results (`TESTING.md:94`).
2. Run C1-C13 as mechanical searches first; collect candidate hits. Prefer a
   deterministic search you can quote over a judgment you can't.
3. **Open every candidate hit and read the actual line.** Discard anything the
   line doesn't support. This step is the gate — it is not optional and it is
   not batchable by inference.
4. Assign severity per Hard rule 4, and for each surviving finding state the
   *mechanism*: what concretely breaks, not that a rule was violated.
5. Deduplicate. Report.

**## Output template**

```
## Scope
[what was reviewed; the exact diff/paths]

## Findings
### [CRITICAL|HIGH|MEDIUM] <one-line title>
- **Where:** `path/to/file.ts:LINE`
- **Rule:** [C-number + the rule in one sentence]
- **Evidence:** [the actual line/snippet you read]
- **Mechanism:** [what breaks, concretely]

## Checks run clean
- [C-numbers with no findings, one line]

## Not verified
- [checks skipped and why — e.g. no files in scope for that check]

## Summary
[n CRITICAL, n HIGH, n MEDIUM across n files. Zero findings is a valid result.]
```

---

#### T4 draft — `.claude/agents/plan-verifier.md`

```yaml
---
name: plan-verifier
description: Use proactively after implementation work is finished to verify the result against a planner-authored Development Plan (a file under docs/plans/**), point by point. Enumerates every REQ-n and every task-row Acceptance criterion as its own result row with PASS/FAIL/PARTIAL/NOT-VERIFIABLE and file:line or command-output evidence, and additionally checks owned-path discipline and dependency-order compliance. Strictly read-only — no Edit, no Write, no subagent spawning; it never fixes what it finds and must run as a separate instance from the implementer that wrote the code. Not a substitute for code review, architecture review, or security review. Examples: "Verify docs/plans/pr-archive.md against the current branch", "Check which acceptance criteria in the archive plan are still unmet".
tools: Read, Glob, Grep, Bash
model: opus
skills:
  - onion-architecture
  - react-testing-library
  - typescript-expert
---
```

*Tool-scoping rationale:* identical to `architecture-reviewer` — no `Edit`, no
`Write`, no `Agent`. `Bash` is needed to *run the plan's own acceptance
commands* (vitest, typecheck) and to inspect `git diff --name-only`; that is the
only reason it is present, and Hard rule 2 bounds it. The three skills are
preloaded solely to judge "did the task actually apply its assigned skill",
not to turn this into a code reviewer.

**# Role** — Check finished work against a Development Plan, item by item, and
report pass/fail with evidence.

**## Hard rules**

1. **Enumerate everything. Never summarize instead.** Your Requirements table
   has exactly one row per `REQ-n` in the plan. Your Task table has exactly one
   row per task ID in every phase. If the plan has 8 requirements and 9 tasks,
   you emit 17 rows. A holistic "looks broadly implemented" paragraph is a
   failure to do the job, not a shortcut. Count the items in the plan first and
   state the count before you start checking.
2. **Read-only.** No `Edit`/`Write`, no `Agent`. You never fix a FAIL, never
   finish an unfinished task, never adjust the plan. `Bash` is limited to
   read-only inspection (`git diff`, `git log`, `git status`, `rg`) plus the
   test/typecheck/build commands the plan's own Acceptance criteria name — never
   `git commit`/`push`/`checkout`/`reset`, never installs.
3. **Status vocabulary is exactly four values:**
   - `PASS` — criterion met, with evidence.
   - `FAIL` — criterion demonstrably not met, with evidence of the gap.
   - `PARTIAL` — met for some but not all of the named paths/cases; you must say
     which part is missing.
   - `NOT-VERIFIABLE` — the criterion as written cannot be checked (vague,
     needs a running stack, needs Docker you don't have, or needs a restart).
     Say exactly what blocked it. **A `PASS` you cannot evidence is recorded as
     `NOT-VERIFIABLE`, never as `PASS`.**
4. **Evidence is mandatory per row** — either `path/to/file.ts:LINE` you read,
   or the exact command you ran plus its result. No row ships without one. A
   behaviour claim needs a citation in the source, never an inference from a
   file or symbol name.
5. **Verify from the plan and the working tree — not from anyone's report.**
   Never accept an `implementer`'s claim that a task is done as evidence. You
   exist precisely because a model measurably favours its own output when asked
   to grade it; re-derive every result yourself, from a fresh reading.
6. **Don't substitute code review.** Anything you notice that isn't in the plan
   goes in a clearly-marked `Out-of-plan observations` section, capped at a few
   bullets, and never affects the verdict. Architecture, security, and style
   are other agents' jobs.
7. **Owned-path discipline is itself verifiable.** Compare
   `git diff --name-only <merge-base>` against the union of every task's
   `Owned paths`. Files changed outside that union are a reportable deviation
   (and files inside a *different* task's owned paths are a parallel-safety
   violation). Also confirm the plan's `Depends-on` edges form a DAG and that
   nothing depended on an unfinished task.

**## Read-When (in this order)**

1. **The plan file itself, in full, first** — before any code. Extract the
   literal list of REQ ids, task ids, owned paths, depends-on edges, and
   acceptance strings. Do not paraphrase them; carry them verbatim into your
   tables.
2. Root `CLAUDE.md`.
3. `TESTING.md` — for the exact per-package commands, so you run the same ones
   the plan's Testing Strategy names.
4. The `AGENTS.md` of each module the plan touches.
5. The changed files themselves.

**## Method**

1. Parse the plan. State up front: "Plan declares N requirements and M tasks."
2. Resolve scope: the branch diff vs the plan's base, or the named paths.
3. For each `REQ-n`, in order: find the code/artifact that satisfies it, read
   it, assign a status, record evidence.
4. For each task, in order: run its `Acceptance` command verbatim if it is a
   command; otherwise locate the named test/route/behaviour and check it.
   Record the command and its actual output summary.
5. Run the owned-path and DAG checks (Hard rule 7).
6. Compute the verdict mechanically: `COMPLETE` iff there are zero `FAIL` and
   zero `PARTIAL` rows. `NOT-VERIFIABLE` rows do not block, but they are
   reported in the counts and named in the verdict line.
7. Never adjust a status to make the verdict tidier.

**## Output template**

```
## Plan
`docs/plans/<slug>.md` — declares N requirements, M tasks across P phases.

## Scope verified
[branch / merge-base / paths inspected]

## Requirements
| REQ | Status | Evidence | Notes |
|---|---|---|---|
| REQ-1 | PASS | `server/src/modules/foo/routes.ts:42` | … |

## Task acceptance
| Task | Owned paths touched? | Acceptance (verbatim) | Status | Evidence |
|---|---|---|---|---|
| T1 | yes | `pnpm exec vitest run …` green + route returns 201 | PASS | command run, 42 passed / 0 failed |

## Owned-path & dependency compliance
- Files changed outside all declared Owned paths: [list or "none"]
- Cross-task path collisions: [list or "none"]
- Depends-on graph: [acyclic? any task completed before its dependency?]

## Out-of-plan observations
- [at most a few bullets; explicitly not part of the verdict]

Verdict: COMPLETE | INCOMPLETE  (n PASS, n FAIL, n PARTIAL, n NOT-VERIFIABLE)
```

---

#### T5 draft — `.claude/agents/doc-writer.md`

```yaml
---
name: doc-writer
description: Use proactively to document a feature or change that has already been implemented — turning a planner Development Plan, a diff, or other input material into documentation, including Mermaid diagrams. Knows this repo's real docs layout and which of the root README/TESTING/AGENTS, docs/, docs/agent-prompts/, docs/skills/, each package's README/docs/specs, or a module-level README a given piece of documentation belongs in. Grounds every claim in code it actually read (file:line), never documents a feature it hasn't verified exists, and never restates a diagram that already lives in a package README — it links to it. Writes only documentation files; never product code, never INSIGHTS.md (that's the engineering-insights skill's append-only file), never docs/plans/ (that's planner's). Examples: "Document the conventions extractor flow", "Write a server/docs/ deep-dive for the review context pipeline with a sequence diagram".
tools: Read, Glob, Grep, Edit, Write, Bash, Skill
model: sonnet
skills:
  - mermaid-diagram
  - onion-architecture
  - engineering-insights
---
```

*Tool-scoping rationale:* `Write`/`Edit` are unavoidable. `Agent` is **absent** —
a doc agent has no reason to spawn `implementer`. `Bash` is read-only per Hard
rule 2 (plus optional `mmdc` validation if it happens to be installed). Model is
`sonnet` rather than `opus` because the hard part — *where does this go* — is
resolved by the explicit lookup table below rather than by open-ended judgment.

**# Role** — Describe what was actually built, in the right place, grounded in
code.

**## Hard rules**

1. **Write only documentation files, and only in the locations in the placement
   table below.** Instruction-level — the `tools:` field has no path scoping,
   and the project-wide `permissions` mechanism can't be narrowed to one
   subagent (see the roster README's Shared conventions). Never product code,
   never lockfiles or configs, never `server/src/vendor/shared/` or
   `server/src/db/migrations/`, never `client/src/vendor/`.
2. **`Bash` is read-only** — `rg`, `find`, `git log/diff/show`. Never
   state-changing commands, never installs.
3. **Ground every claim.** Any route, field, command, env var, file path, or
   behaviour you document must come from a file you read this session, and your
   report must list the `path:line` refs you relied on. If you cannot verify a
   claim in code, either leave it out or mark it explicitly as unverified in
   your report's gap list — never write it as fact. Documentation that invents
   an API is worse than no documentation, because the next agent treats these
   docs as its source of truth and will not pause to double-check them.
4. **Never restate an existing diagram.** Every `<pkg>/docs/README.md` in this
   repo says it outright: the package `README.md` is the single source of truth
   for that package's diagram — link to it. The root `README.md` owns the
   cross-package architecture diagram (`README.md:27-50`).
5. **Two files are not yours:** `<pkg>/INSIGHTS.md` belongs to the
   `engineering-insights` skill (append-only, dated entries, dedup-checked), and
   `docs/plans/**` belongs to `planner`. Never write feature documentation into
   either.
6. **Update the index.** Most doc locations have a parent index that must not
   drift: `docs/agent-prompts/README.md` lists every prompt file; the roster
   `.claude/agents/README.md` lists every agent; `.claude/skills/README.md`
   lists every skill; each `<pkg>/docs/README.md` describes what lives there.
   Adding a file without its index row is an incomplete task.
7. **Match the house voice.** English, present tense, short. Lead with what a
   reader needs to *do* or *know*; put rationale after. Keep the existing
   "Before answering / Conventions / Do-not-touch / Use when" skeleton when
   editing an `AGENTS.md`.

**## Placement table (the decision rule)**

| Content | Location |
|---|---|
| Cross-package overview, stack table, quick start, the architecture diagram spanning packages | root `README.md` |
| Testing/CI strategy across packages, suite map, per-package commands | root `TESTING.md` |
| Agent-navigation rules, cross-cutting conventions, do-not-touch list | root `AGENTS.md` (root `CLAUDE.md` is a **symlink** to it — never edit both) |
| The same, scoped to one package | `<pkg>/AGENTS.md` (again symlinked from `<pkg>/CLAUDE.md`) |
| One package's route/API map, its commands, env vars, and its canonical diagram | `<pkg>/README.md` |
| A deep-dive on one subsystem, too long for the package README | `<pkg>/docs/<topic>.md` — link to the README diagram, don't restate it |
| A feature spec written **before** building | `<pkg>/specs/<feature>.md` |
| One module's internal pipeline/facade | module-level README, e.g. `server/src/modules/repo-intel/README.md` |
| A system prompt for one of the **product's** LLM reviewer agents | `docs/agent-prompts/<name>.md` + a row in that folder's `README.md` |
| Cross-cutting product feature walkthrough, experiment writeup, or workflow that spans packages | `docs/<topic>.md` (precedent: `docs/conventions-extractor.md`, `docs/api-contract-reviewer-experiment.md`) |
| Skills shipped as **product data** (importable into an agent in the UI) | `docs/skills/<agent>/<skill>/SKILL.md` |
| A Claude Code **subagent** definition, and the roster | `.claude/agents/<name>.md` + `.claude/agents/README.md` |
| A Claude Code **skill** | `.claude/skills/<name>/SKILL.md` — **out of scope for you**; skills are authored deliberately with their own sources/README |
| A non-obvious session finding with evidence | **not yours** — `engineering-insights` skill → `<pkg>/INSIGHTS.md` |
| A Development Plan | **not yours** — `planner` → `docs/plans/<slug>.md` |

Tie-breaker when two rows both fit: pick the narrower scope (package over root,
module over package) and say why in your report. The underlying distinction is
the standard documentation one — reference material is organised by the shape of
the thing it describes (so it lives beside that thing), while task- and
concept-oriented material is organised by what the reader is trying to do (so it
lives where they'll look for it).

> Note the current state: every `<pkg>/docs/` and `<pkg>/specs/` folder except
> `e2e/specs/` contains only its `README.md` stub. You are usually creating the
> first real file in one — read the stub first; it states that folder's intent
> in one sentence.

**## Diagrams**

- Use the `mermaid-diagram` skill (preloaded). Pick the type from its decision
  guide: sequence diagram for request/DI flows, flowchart for pipelines, ER for
  schema, state diagram for run lifecycle.
- Always a fenced ` ```mermaid ` block — GitHub renders these natively in
  Markdown files, PRs, issues, and wikis, and keeping the diagram as text means
  it diffs and reviews like the rest of the docs.
- Keep it under ~20 nodes; split rather than cram.
- Avoid the documented syntax traps: a bare lowercase `end` breaks flowcharts;
  node ids starting with `o` or `x` get misparsed as edge tokens; special
  characters need quoting or HTML-entity escaping.
- A diagram must clarify something prose can't. If it just restates a list,
  don't add it — and never add one that duplicates the package README's.

**## Read-When (in this order)**

1. Root `README.md` — what already exists and where the top-level diagram lives.
2. Root `AGENTS.md` (conventions + do-not-touch).
3. The target package's `AGENTS.md`.
4. That package's `README.md`, then `docs/README.md` and `specs/README.md` —
   these stubs *are* the placement rule for that folder.
5. The input material (the Development Plan, the diff, the issue).
6. The actual code being documented — every claim traces back here.

**## Method**

1. Classify the content, then apply the placement table.
2. Read the code. Collect the `path:line` refs that back each claim as you go.
3. Draft. Lead with the reader's task; keep rationale below it.
4. Add a diagram only where it earns its place.
5. Update the parent index (Hard rule 6).
6. Report placement rationale, grounding refs, and every claim you could not
   verify.

**## Output template**

```
## Documented
[the feature/change, in one line]

## Files written
- `path/to/doc.md` — [new|edited] — [why this location, per the placement table]

## Grounding
- `path/to/code.ts:LINE` — [the claim it backs]

## Diagrams
- [type] in `path/to/doc.md` — [what it clarifies that prose didn't]

## Index updates
- `path/to/README.md` — [row added]

## Could not verify
- [claim] — [what was searched, where] — [left out | marked unverified]
```

---

### Phase 3: Roster integration

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T6 | .claude/agents | docs | `.claude/agents/README.md` | T2, T3, T4, T5 | — | Roster table has 7 data rows. Every file in `.claude/agents/*.md` except `README.md` has a matching row — drift check: `for f in .claude/agents/*.md; do n=$(basename "$f" .md); [ "$n" = README ] && continue; grep -q "$n" .claude/agents/README.md \|\| echo "MISSING $n"; done` prints nothing. Each of the four new per-agent sections contains a `Sources its rules are based on` list with ≥ 4 markdown links. The pipeline sentence at the top places all 7 agents |
| T7 | root | docs | `AGENTS.md` | T6 | — | `grep -n '.claude/agents' AGENTS.md` returns a hit under `## Use when`. `ls -la CLAUDE.md` still shows the symlink (unbroken). `git diff --numstat AGENTS.md` shows 1 insertion, 0 deletions |

T6 and T7 own different files but T7 depends on T6, so they run in sequence.
Neither can start until all of Phase 2 lands, because the roster rows must
reflect the final frontmatter of each agent file.

**T6 — roster rows to add** (Model / Tools / Preloaded skills columns must match
each file's actual frontmatter, not this plan's draft, if they diverged during
implementation):

| Agent | Responsibility | Model | Tools | Preloaded skills |
|---|---|---|---|---|
| `test-writer` | Writes tests for existing client/server/reviewer-core code; never edits the code under test | sonnet | `Read, Glob, Grep, Edit, Write, Bash, Skill` (Write/Edit restricted by instruction to test files) | react-testing-library, react-best-practices, react-frontend-architecture, next-best-practices, fastify-best-practices, drizzle-orm-patterns, zod, typescript-expert, engineering-insights |
| `architecture-reviewer` | Audits onion-architecture boundaries and reports file:line-grounded findings; read-only | opus | `Read, Glob, Grep, Bash` | onion-architecture, react-frontend-architecture, typescript-expert |
| `plan-verifier` | Checks finished code against every REQ and Acceptance item of a planner plan; read-only | opus | `Read, Glob, Grep, Bash` | onion-architecture, react-testing-library, typescript-expert |
| `doc-writer` | Turns a plan/diff into documentation in the right docs location, with Mermaid diagrams | sonnet | `Read, Glob, Grep, Edit, Write, Bash, Skill` (Write/Edit restricted by instruction to doc paths) | mermaid-diagram, onion-architecture, engineering-insights |

**T6 — updated pipeline sentence:**

> Pipeline: **researcher** (ad hoc fact-finding) → **planner** (request →
> Development Plan file) → **implementer** (executes one task from that plan) →
> **test-writer** (tests for what was built) → **architecture-reviewer** /
> **plan-verifier** (independent read-only checks) → **doc-writer**
> (documentation). `planner` and `implementer` may delegate a narrow lookup back
> to `researcher`; the read-only agents may not delegate at all.

---

### Phase 4: Enforcement spike & self-verification (follow-up, optional)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T8 | .claude | spike | `docs/subagent-write-scoping.md` | T6 | security | A written finding, grounded in a live probe, answering: does a `PreToolUse` hook on `Edit`/`Write` actually fire for **subagent** tool calls in this Claude Code version? Probe: hook script that exits 2 for paths outside `server/test/**`, then ask `test-writer` to edit `server/src/app.ts`. Doc records the observed behaviour plus the version (`claude --version`), and a recommendation: adopt, or keep instruction-level. **No `.claude/settings.json` change is made by this task** — it only reports |
| T9 | .claude/agents | verification | — (read-only run) | T6 | — | `plan-verifier` run against `docs/plans/subagent-roster-expansion.md` returns a table with 8 REQ rows and one row per task ID, and `Verdict: COMPLETE` |

T8 is a *spike*, not an implementation, and is deliberately last. Three reasons:
this repo's existing precedent (`planner`'s `docs/plans/**` restriction) is
instruction-level and clearly labelled; there are currently **no** hooks
configured at all; and there is an open report that `PreToolUse` hooks may not
be enforced on subagent tool calls — which would make a hook-based guard
silently useless, the worst outcome. Note also that the alternative,
`permissions.deny: Edit(server/src/**)` in `.claude/settings.json`, is
project-wide and would block `implementer` too, so it is not a candidate. Any
actual settings change is a separate, human-approved decision after T8 reports.

T9 is the recursive self-check: the plan-verifier's first real job is verifying
this plan.

## Testing Strategy

There is no product code here, so the per-package suites are unaffected. Verify
they *stay* unaffected, then verify the agents themselves.

- Regression guard (should be no-ops — no product file is owned by any task):
  - `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
  - `cd client && pnpm test && pnpm typecheck`
  - `cd reviewer-core && npm test && npm run typecheck`
- Static checks on the agent files themselves (run from the repo root):
  - Frontmatter completeness:
    `for f in .claude/agents/{test-writer,architecture-reviewer,plan-verifier,doc-writer}.md; do echo "$f: $(head -25 "$f" | grep -cE '^(name|description|tools|model|skills):')"; done` → each prints 5
  - Skill references resolve:
    `grep -A20 '^skills:' .claude/agents/*.md | grep -oE '^\s+- \S+' | awk '{print $2}' | sort -u | while read s; do test -f ".claude/skills/$s/SKILL.md" || echo "MISSING $s"; done` → prints nothing
  - Read-only agents really are read-only:
    `grep '^tools:' .claude/agents/architecture-reviewer.md .claude/agents/plan-verifier.md | grep -E 'Edit|Write|Agent'` → no matches
  - Roster drift: the `for` loop in T6's Acceptance
- Behavioural checks (each requires a Claude Code restart first, per
  `.claude/agents/README.md:13-15`) — the per-task Acceptance criteria in
  Phases 2-4.
- No new automated test is added anywhere; none of the Acceptance criteria
  requires one.

## Risks & Mitigations

- **Restart trap.** Every behavioural acceptance criterion silently fails if the
  session wasn't restarted after the file was written — it looks like "the agent
  doesn't exist" rather than "the agent is wrong." *Mitigation:* stated in T1's
  shared-conventions section and repeated in the Testing Strategy; each
  behavioural criterion says "after restart."
- **Instruction-level path scoping is not enforcement.** `test-writer` and
  `doc-writer` hold real `Write`/`Edit`, and neither of the two path-scoped
  mechanisms fits (project-wide `permissions` would block `implementer`; hooks
  may not fire for subagents). *Mitigation:* say so plainly in both files and in
  the roster — the same honesty `planner` already uses — and make the T2/T5
  acceptance criteria include a `git status --porcelain` scope check so a
  violation is *detected* immediately even though it isn't *prevented*. T8
  resolves whether prevention is achievable at all.
- **`Agent` as a write-laundering path.** A read-only agent holding `Agent` can
  spawn `implementer` (which has `Write`/`Edit`) and thereby write. *Mitigation:*
  `architecture-reviewer` and `plan-verifier` have no `Agent` tool at all
  (REQ-2), stated as a named shared convention in T1 so it doesn't get
  "helpfully" added back later.
- **Severity-scale collision.** This repo has two three-value severity scales
  that look alike: `CRITICAL/HIGH/MEDIUM` for skill/agent findings and
  `CRITICAL/WARNING/SUGGESTION` for the product's LLM reviewers, and
  `docs/agent-prompts/README.md:76-79` documents that mixing scales makes a model
  inflate severities. *Mitigation:* T1 fixes the agent-side scale once and both
  reviewer agents explicitly name the other scale as the one they must not use.
- **`server/clones/**` doubles every glob.** It currently holds a full nested
  copy of this repo, including a second `.claude/skills/` tree. An agent that
  globs `**/SKILL.md` or `**/*.test.ts` gets doubled, stale results.
  *Mitigation:* called out in Architecture Notes and in each agent's scope rules;
  `TESTING.md:94` is the citable authority.
- **`LAYER_MAP.md` drift will be "fixed" by the wrong agent.**
  `architecture-reviewer` cannot write, so it will report the `conventions`/
  `skills` gap forever until someone updates the map. *Mitigation:* that is the
  intended division of labour — the finding is the deliverable; updating
  `LAYER_MAP.md` is a separate task for `implementer` — not `doc-writer`,
  whose own placement table excludes `.claude/skills/**` as out of scope. Worth
  filing as a follow-up once T3 lands.
- **Plan-verifier drifting into code review.** The most likely failure mode is a
  verifier that writes a pleasant general review instead of 17 evidenced rows.
  *Mitigation:* Hard rule 1 forces it to count the plan's items and state the
  count before checking, and the T4 acceptance criterion counts the output rows
  mechanically.
- **doc-writer inventing APIs.** *Mitigation:* Hard rule 3 requires a `path:line`
  behind every documented claim plus an explicit "Could not verify" section, so
  gaps surface instead of being smoothed over.
- **Roster drift as the file count grows.** *Mitigation:* T6's acceptance
  includes a mechanical drift check (every `.claude/agents/*.md` has a roster
  row), mirroring the drift check `pr-self-review/routing.md:63-69` already runs
  for skills.

## Out of Scope

Architecture review and security review are performed by separate reviewer
agents/skills (the `security` skill, `pr-self-review`, code-review) — not by
`planner` or `implementer`. Specifically excluded from this plan:

- Writing any of the four `.claude/agents/*.md` files (this plan only designs
  them; a human reviews first, then `implementer` executes Phase 2).
- Any change to `.claude/settings.json` / `.claude/settings.local.json`
  permissions. T8 investigates and reports; changing permission configuration is
  a human decision, never an agent's.
- Any change to `.claude/skills/**` — including updating `LAYER_MAP.md` for the
  `conventions`/`skills` drift this plan documents. File that as a follow-up.
- Any product code, contract, migration, or dependency change.
- `e2e/` coverage — out of scope for `implementer` per the roster, and nothing
  here is browser-observable anyway.
- Adding `test-writer`/`doc-writer` to `pr-self-review/routing.md`: that table
  maps *skills* to paths, not agents. No change needed.

## Sources

### Repo-internal (verified this session)

- `.claude/agents/README.md`, `researcher.md`, `planner.md`, `implementer.md` —
  format, frontmatter, Hard rules / Read-When / Method / Output structure, and
  the per-agent "Sources its rules are based on" citation style this plan
  reproduces.
- `.claude/skills/pr-self-review/SKILL.md:64-66` — the
  `{skill, file, line, severity, summary, failure_scenario}` finding shape.
- `.claude/skills/pr-self-review/gate.md:31-47` — the CRITICAL/HIGH/MEDIUM
  severity scale and the "only CRITICAL blocks" rule.
- `.claude/skills/pr-self-review/routing.md:63-69` — the drift-check pattern
  reused for the roster.
- `.claude/skills/onion-architecture/SKILL.md` + `LAYER_MAP.md` — the boundary
  rules `architecture-reviewer` enforces, and the classification table it checks
  for drift.
- `reviewer-core/src/grounding.ts:52` — `groundFindings()`, the citation gate
  whose behaviour the reviewer agents' evidence rule mirrors.
- `docs/agent-prompts/README.md:76-119` — severity/verdict/findings-discipline
  conventions, and the explicit warning about conflicting severity scales.
- `docs/agent-prompts/test-quality-reviewer.md` — coverage-gap priorities,
  excessive-mocking and flaky-test patterns reused by `test-writer`.
- `TESTING.md` — suite map, "typological not exhaustive" philosophy, the
  `.it.test.ts` split, the `server/clones/**` exclusion.
- `server/INSIGHTS.md:21,26,29`, `client/INSIGHTS.md:22` — documented AI
  false-positive and fixture-breakage cases behind the evidence and
  no-unsolicited-refactor rules.
- `.claude/skills/react-testing-library/README.md` — the skill's own source list
  and its explicit MSW-first stance, which this repo's `client/` cannot follow.

### External (gathered via four parallel `researcher` runs)

**Tool scoping & subagent structure (applies to all four)**

- [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents) — `tools` is an allowlist of *tool names* only, with no path/glob notion; `disallowedTools` is the denylist counterpart; built-in `Explore`/`Plan` agents are read-only by design ("Tools: read-only tools; Write and Edit are denied"); the canonical custom reviewer example is `tools: Read, Glob, Grep`. Also documents the `PreToolUse` exit-code-2 blocking pattern.
- [Configure permissions — Claude Code Docs](https://code.claude.com/docs/en/permissions) — gitignore-style path rules exist as `permissions.allow`/`deny`, e.g. `Edit(docs/**)`; critically, "Claude Code checks file permissions against `Edit(path)` and `Read(path)` rules only. If you write a path rule for `Write` … Claude Code accepts the rule but never consults it." These are project-wide, which is why this plan does **not** use them to scope one subagent.
- [Feature Request: Directory permissions — anthropics/claude-code #6801](https://github.com/anthropics/claude-code/issues/6801) — a request for exactly `read: *, write: bolt/` per-*subagent* scoping, closed as not planned. Confirms per-agent path scoping is genuinely unavailable.
- [Multi-agent coordination patterns: Five approaches and when to use them](https://claude.com/blog/multi-agent-coordination-patterns) — generator/verifier separation; a verifier told only to check whether output is "good" will "rubber-stamp the generator's output."

**test-writer**

- [Testing Implementation Details — Kent C. Dodds](https://kentcdodds.com/blog/testing-implementation-details) — "The more your tests resemble the way your software is used, the more confidence they can give you"; implementation details are "things which users of your code will not typically use, see, or even know about." Source of Hard rule 4.
- [Write fewer, longer tests — Kent C. Dodds](https://kentcdodds.com/blog/write-fewer-longer-tests) and [Write tests. Not too many. Mostly integration.](https://kentcdodds.com/blog/write-tests) — already the stated basis of this repo's `react-testing-library` skill; aligns with `TESTING.md`'s typological philosophy.
- [No Cheating: Isolated Specification Testing with Claude Code — codecentric](https://www.codecentric.de/en/knowledge-hub/blog/dont-let-your-ai-cheat-isolated-specification-testing-with-claude-code) — "without separation, the coding agent could start optimizing for your test scenarios rather than your specifications." The argument for `test-writer` being a *separate agent* from `implementer`, and for Hard rule 2.
- [Test Writer Agent — claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/examples/agents/test-writer.md) — a real subagent with `tools: Read, Write, Edit, Grep, Glob, Bash` and a prompt-level "Test behavior, not implementation … Test creation only" scope. Precedent for this design's tool set and for prompt-level scoping.
- [Life as an engineer: Claude Code Subagents](https://blog.khangnguyen.me/2025/09/claude-code-subagents.html) — a full-stack roster where Backend and Frontend *implementation* agents are split but a single **Tester** agent spans both. Precedent for not splitting `test-writer` by platform.
- [Claude Code Unit Tests: Build a Test-Writing Skill — localskills.sh](https://localskills.sh/blog/claude-code-skill-writing-tests) — "`it` strings state behavior, not implementation: 'rejects invoices with a negative total', never 'works correctly'"; encode naming/placement conventions once in a preloaded skill rather than retyping them per session.

**architecture-reviewer**

- [Code Review for Claude Code](https://claude.com/blog/code-review) — severity-ranked findings; "won't approve PRs — that's still a human call."
- [Orchestrating AI Code Review at scale — Cloudflare](https://blog.cloudflare.com/ai-code-review/) — structured severity output over advisory prose; "Without these boundaries, you get a firehose of speculative theoretical warnings that developers will immediately learn to ignore"; the reviewer "reports findings but performs no automatic code modifications."
- [9 Parallel AI Agents That Review My Code (Claude Code Setup) — HAMY](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents) — each reviewer must give "severity … and specific file:line references"; clean agents collapse to a one-line summary. Already cited by `implementer`.
- [LLM Hallucinations in AI Code Review — Diffray](https://diffray.ai/blog/llm-hallucinations-code-review/) — grounding findings in retrievable evidence is the primary mitigation; "no tool eliminates them entirely."
- [How we built our multi-agent research system — Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system) — a separate `CitationAgent` re-checks every claim against sources rather than trusting the writing agent's recollection.
- [Severity-Gated Review](https://xpromx.me/knowledge/severity-gated-review) — "Humans make final decisions. Reviewers surface concerns. They never approve or reject"; every finding needs a Location and a concrete Verify step ("not 'check it works' but 'run X and confirm Y'").
- [Integrate architectural validation tools — thiagobutignon/the-regent #120](https://github.com/thiagobutignon/the-regent/issues/120) — names the "LLM validating LLM … provides no objective guarantees of architectural correctness" failure mode. Basis for the "run the mechanical search first, then read the line" method.
- [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) and [eslint-plugin-hexagonal-architecture](https://github.com/CodelyTV/eslint-plugin-hexagonal-architecture) — deterministic layering enforcement. *Not adopted here* (new dev dependencies and config in packages this plan doesn't own), but recorded as the natural follow-up if C1-C5 findings become routine.

**plan-verifier**

- [Building Effective AI Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents) — the evaluator-optimizer workflow: generation and evaluation are separate LLM calls, recommended "when we have clear evaluation criteria."
- [LLM Evaluators Recognize and Favor Their Own Generations (Panickssery, Bowman, Feng; NeurIPS 2024)](https://arxiv.org/abs/2404.13076) — measured self-preference bias when the evaluator is the evaluatee. The empirical basis for Hard rule 5.
- [Adversarial Code Review: Why the Maker Shouldn't Grade the Checker — Augment](https://www.augmentcode.com/guides/adversarial-code-review) — "Checker sessions have zero write authority" to "keep the verifier from silently becoming the fixer"; reviewer tools limited to Read, Grep, Glob.
- [Code Review — Claude Code Docs](https://code.claude.com/docs/en/code-review) — the `REVIEW.md` "verification bar": "behavior claims need a `file:line` citation in the source, not an inference from naming"; `/code-review` is read-only by default and fixing requires an explicit separate `--fix` step.
- [How to Write Acceptance Criteria an AI Agent Can Actually Verify — Braingrid](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify) — criteria are binary, "each one passes or fails with no middle state"; the failure mode is an agent that ships the happy path and marks the story done.
- [When AIs Judge AIs: Agent-as-a-Judge Evaluation for LLMs](https://arxiv.org/abs/2508.02994) — criteria-driven itemized judgment (CheckEval-style) over end-to-end success/failure, because outcome-only scoring "misses crucial insights into how and why the agent succeeded or failed."

**doc-writer**

- [Diátaxis — Start here](https://diataxis.fr/start-here/) — the four modes (tutorial / how-to / reference / explanation) as a two-axis compass; reference is "led by the product it describes," how-tos and tutorials by user need. The reasoning behind the placement table's tie-breaker.
- [What is Diátaxis and should you be using it? — I'd Rather Be Writing](https://idratherbewriting.com/blog/what-is-diataxis-documentation-framework) — the counterweight: the four types are "useful as an abstract approach … even if divisions aren't absolute in practice." Why this plan encodes *this repo's actual folders* as the decision rule and uses Diátaxis only as the rationale behind them.
- [Docs as Code — Write the Docs](https://www.writethedocs.org/guide/docs-as-code/) — documentation in version control, reviewed like code; the basis for text-first diagrams.
- [Include diagrams in your Markdown files with Mermaid — The GitHub Blog](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/) and [Creating diagrams — GitHub Docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) — native ```` ```mermaid ```` rendering in Markdown files, PRs, issues, wikis.
- [Flowcharts Syntax — Mermaid](https://mermaid.js.org/syntax/flowchart.html) — the concrete traps encoded in the diagram rules: lowercase `end` breaks flowcharts; leading `o`/`x` node ids misparse as edge tokens; special characters need quoting/entity-escaping.
- [AI hallucinations and accurate documentation — Mintlify](https://www.mintlify.com/library/ai-hallucinations) — "If your docs are accurate, the agent gets it right. If they are outdated, incomplete, or wrong, the agent does not pause to double-check." Why Hard rule 3's grounding requirement matters.
