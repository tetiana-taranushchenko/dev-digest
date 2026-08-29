# .claude/agents/ — agent roster

Map of the custom Claude Code subagents defined in this folder. This file
describes *what each agent is and how they fit together* — for the actual
rules, read the agent's own `.md` file; nothing here should be treated as a
substitute for it.

Pipeline: **researcher** (ad hoc fact-finding) → **spec-creator** (request +
designs → approved feature spec) → **implementation-planner** (maps source
AC-IDs to implementation tasks → Development Plan file) →
**implementer** (executes one task from that plan) → **architecture-reviewer**
→ **plan-verifier** (final gate) → **doc-writer** (documentation).
`spec-creator`, `implementation-planner`, and `implementer` may delegate a
narrow lookup back to `researcher`; the read-only agents may not delegate at
all. `spec-creator` is a required precondition for `implementation-planner`:
the planner never turns a raw request into a plan and never resolves product
questions. A missing, unapproved, or unresolved spec is returned to
`spec-creator` before planning begins.

**Two invocation halves.** `spec-creator` and `implementation-planner` are
always invoked directly by the user (never chained automatically) — they're
the planning half, done once per feature, before any code exists. Everything
from `implementer` onward is the execution half, and is automated end-to-end
by `.claude/skills/implement-plan/SKILL.md`: `/implement-plan
plan:docs/plans/<slug>.md [mode:...] [max-fix:...]` runs implementer(s) per
phase, then `architecture-reviewer` and `plan-verifier` in parallel, then a
bounded iterative fix loop (`max-fix` rounds, default 3) that re-checks only
what previously failed, then `doc-writer` once the verdict is `COMPLETE`.
**`test-writer` is currently excluded from that automated flow** (a
deliberate cost decision — see the skill file) — invoke it by hand when a
task's Verification genuinely names a new test.

> New or edited files here aren't picked up by a running session — restart
> Claude Code before an agent added or changed in this folder becomes a
> callable `subagent_type`.

## Shared conventions

1. **Severity scale.** Agent findings use `CRITICAL / HIGH / MEDIUM`, the scale
   already established across this repo's skills
   (`.claude/skills/pr-self-review/gate.md:31-47`). This is deliberately *not*
   the product's `CRITICAL | WARNING | SUGGESTION` enum
   (`docs/agent-prompts/README.md:76-79`) — that one is the LLM review contract
   enforced out of band by a JSON schema, and mixing the two scales is exactly
   the failure that doc warns about. Anti-inflation rule: assign the severity
   you would defend to the author's face; only CRITICAL is treated as blocking.
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
4. **No `Agent` for read-only agents.** A read-only agent that keeps the
   `Agent` tool can spawn `implementer`, which has `Write`/`Edit` — laundering a
   write through a subagent and defeating the allowlist.
   `architecture-reviewer` and `plan-verifier` therefore have no `Agent` tool
   at all. (`implementation-planner` keeps `Agent` deliberately: it needs
   `researcher`, and it already holds `Write`.)
5. **Enforcement limits, stated honestly.** The `tools:` field scopes by tool
   *name* only — it has no path or glob notion. Path-scoped rules do exist as
   `permissions.allow`/`permissions.deny` entries in `.claude/settings.json`
   (gitignore-style, e.g. `Edit(server/test/**)`; note path rules are consulted
   for `Edit(path)`/`Read(path)` and **not** for `Write(path)`), but those
   settings are *project-wide*, not per-subagent — a deny that keeps
   `test-writer` out of `server/src/**` would equally block `implementer`. So
   for agents that legitimately need `Write`/`Edit`, the path restriction is
   instruction-level, and each such agent says so in its own Hard rules rather
   than implying a sandbox that isn't there.
6. **Restart caveat.** As stated above, new or edited files here are not picked
   up by a running session. Every acceptance criterion that says "invoke the
   agent" implies a restart first.

| Agent | Responsibility | Model | Tools | Preloaded skills |
|---|---|---|---|---|
| [`researcher`](researcher.md) | Answers one specific question by searching the repo and/or the web; never edits anything | sonnet | `Read, Grep, Glob, Bash, WebFetch, WebSearch` | none |
| [`spec-creator`](spec-creator.md) | Turns a feature request (+ designs — screenshot, URL, existing code, or text) into a Spec-Driven-Development feature spec: problem/user, an optional Recommendations note, goals/non-goals with `G-N` traceability into `AC-N`, EARS acceptance criteria, edge cases, an optional Workflow & communication diagram, verification-hinted NFRs, open questions; enforces one-spec-one-feature, flags design/request contradictions as open questions, and runs a final self-check before writing; can fan out multiple `researcher` calls in parallel for multi-angle investigation; single-module specs go to that module's `specs/**`, cross-module specs (Acceptance criteria/contracts spanning ≥2 modules) go to `specs/**`; never plans implementation or touches product code | opus | `Read, Glob, Grep, WebFetch, Edit, Write, Agent` (Write/Edit restricted by instruction to `server/specs/**`, `client/specs/**`, `reviewer-core/specs/**`, `specs/**`) | mermaid-diagram, security |
| [`implementation-planner`](implementation-planner.md) | Consumes an approved spec, maps every source `AC-N` to phased file-specific tasks, puts one or more AC-IDs on every task, and chooses an execution mode; returns spec gaps to `spec-creator` and never touches product code | opus | `Read, Glob, Grep, Bash, Agent, Write` (Write restricted by instruction to `docs/plans/**`) | onion-architecture, fastify-best-practices, drizzle-orm-patterns, postgresql-table-design, zod, react-frontend-architecture, next-best-practices, react-best-practices, react-testing-library, typescript-expert, security, engineering-insights |
| [`implementer`](implementer.md) | Executes exactly one task from an `implementation-planner`-authored plan (backend and/or frontend), self-verifies with that module's existing tests + typecheck | sonnet | `Read, Glob, Grep, Edit, Write, Bash, Skill, Agent` | same 12 as `implementation-planner` |
| [`test-writer`](test-writer.md) | Writes tests for existing client/server/reviewer-core code; never edits the code under test | sonnet | `Read, Glob, Grep, Edit, Write, Bash, Skill` (Write/Edit restricted by instruction to test files) | react-testing-library, react-best-practices, react-frontend-architecture, next-best-practices, fastify-best-practices, drizzle-orm-patterns, zod, typescript-expert, engineering-insights |
| [`architecture-reviewer`](architecture-reviewer.md) | Audits onion-architecture boundaries and reports file:line-grounded findings; read-only | sonnet | `Read, Glob, Grep, Bash` | onion-architecture, react-frontend-architecture, typescript-expert |
| [`plan-verifier`](plan-verifier.md) | Checks finished code against every source-spec AC and every task Verification item of an implementation-planner plan; read-only | sonnet | `Read, Glob, Grep, Bash` | onion-architecture, react-testing-library, typescript-expert |
| [`doc-writer`](doc-writer.md) | Turns a plan/diff into documentation in the right docs location, with Mermaid diagrams | sonnet | `Read, Glob, Grep, Edit, Write, Bash, Skill` (Write/Edit restricted by instruction to doc paths) | mermaid-diagram, onion-architecture, engineering-insights |

## researcher

- **Input:** a specific question, in the chat/prompt that invokes it.
- **Output:** a structured findings report (Question / Findings / Evidence /
  References / Could not find), returned as text — never a file.
- **Permissions:** read-only everywhere; no `Edit`/`Write`/`Skill`. Asks
  clarifying questions instead of guessing when the request is vague.

## spec-creator

- **Input:** a feature request, in the chat/prompt that invokes it, plus
  optional design material: a screenshot read directly, a URL fetched via
  `WebFetch`, a text description, or — always, when the request changes or
  extends existing behavior — the existing code, read as design material in
  its own right (not just for naming/style conventions).
- **Output:** a feature spec file at `<module>/specs/YYYY-MM-DD-<slug>.md`
  (module = `server`, `client`, `reviewer-core`, or `mcp-server`) for a single-module spec,
  or `specs/YYYY-MM-DD-<slug>.md` for a spec whose Acceptance criteria
  or contracts require coordinated changes across ≥2 modules (never
  `e2e/specs/`, which holds flow definitions, not feature specs): Problem &
  user, an optional Recommendations note (a better approach spotted while
  reviewing, for the user to accept or reject — never folded into Goals
  unilaterally), Goals numbered `G-N` with every `AC-N` citing which `G-N`
  it satisfies (traceability, no orphans), User stories, EARS-format
  Acceptance criteria, Edge cases, an optional Workflow & communication
  section (Mermaid sequence/flow diagram + contract shapes, no
  implementation detail), Non-functional requirements each with a short
  `(verify: ...)` hint, Inputs and provenance, Untrusted inputs, Open
  questions (`[NEEDS CLARIFICATION: ...]` — also used for any contradiction
  between design material and the stated request). The file's `Spec ID:`
  line is `SPEC-YYYY-MM-DD-<slug>` — same date and slug as the filename,
  with a `SPEC-` prefix; a `Related:` header line links specs this one
  depends on or complements (distinct from `Supersedes:`). Enforces one
  spec per feature — a request bundling separable features gets a
  split-it-up question instead of one oversized file — and runs a final
  self-check (EARS/traceability/NFR-hints/section-completeness/placement)
  before writing. Reads only the `INSIGHTS.md` of modules the request
  actually touches, never all of them, and can delegate to multiple
  `researcher` subagents in parallel when an investigation has independent
  angles. Asks clarifying questions instead of guessing on any product
  decision, same convention as `researcher`.
- **Permissions:** read access across the repo plus `WebFetch` for design
  URLs, and `Write`/`Edit` restricted by instruction to `server/specs/**`,
  `client/specs/**`, `reviewer-core/specs/**`, and `specs/**` only —
  never product code, never `e2e/specs/`, never `docs/plans/**`. No `Bash`,
  deliberately: it would otherwise bypass the path restriction the
  tool-permission system can't enforce. Has `Agent` to delegate deep
  external research (prior art, "how do other products handle X") to
  `researcher`, same as
  `implementation-planner`.
- **Sources its rules are based on:**
  - [Alistair Mavin — EARS: Easy Approach to Requirements Syntax (official guide)](https://alistairmavin.com/ears/) — source of the 5 EARS requirement patterns (Ubiquitous/Event-driven/State-driven/Unwanted-behavior/Optional-feature) and the "shall" keyword convention.
  - [Easy Approach to Requirements Syntax — Wikipedia](https://en.wikipedia.org/wiki/Easy_Approach_to_Requirements_Syntax) — history: Mavin, Wilkinson, Harwood, Novak (Rolls-Royce), first published at IEEE RE'09.
  - [github/spec-kit — spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md) — source of the spec.md/plan.md separation (implementation detail belongs to the plan, not the spec) and the `[NEEDS CLARIFICATION]` marker convention.
  - `implementation-planner.md`'s `Implementation Recommendations` section — precedent reused here for HOW-only advice that never changes source acceptance criteria.
  - The `security` skill (`.claude/skills/security/SKILL.md`, OWASP Top 10:2025) — preloaded so the template's `Security` NFR bullet and `Untrusted inputs` section are grounded in concrete categories instead of generic prose.
  - Root [`CLAUDE.md`](../../CLAUDE.md), `server/specs/README.md`, `client/specs/README.md`, `reviewer-core/specs/README.md`, `e2e/specs/README.md`, and [`specs/README.md`](../../specs/README.md) — source of the per-module spec-folder convention, the cross-module `specs/` threshold, "one file per feature," and confirmation that `e2e/specs/` is flow JSON, not feature specs (verified directly, not assumed).

## implementation-planner

- **Input:** an approved `<pkg>/specs/YYYY-MM-DD-<feature>.md` or cross-module
  `specs/YYYY-MM-DD-<feature>.md` with numbered `AC-N` criteria and no
  unresolved `[NEEDS CLARIFICATION]`. Missing or unresolved specs are returned
  to `spec-creator`; the planner does not ask or answer product questions.
- **Output:** a Development Plan file at `docs/plans/<slug>.md` (Source
  Specification / Implementation Recommendations / Execution Mode / Affected
  Modules & Contracts / Architecture Notes / Phases with a task table — AC
  IDs, Owned paths, Depends-on, Skills to use, Verification / AC Coverage /
  Testing Strategy / Risks / Out of Scope), plus a short summary returned as
  text. It honors an explicitly requested execution mode or chooses one from
  the task DAG without pausing for product input.
- **Permissions:** read-only over the repo, plus `Write` — restricted by
  instruction (not by the tool-permission system, which has no path
  scoping) to `docs/plans/**` only. Never `Edit`, never `<pkg>/specs/**` or
  `specs/**`.
- **Sources its rules are based on:**
  - [Claude Code docs — Create custom subagents](https://code.claude.com/docs/en/sub-agents) — planning-type agents get read-only tools (mirrors the built-in `Plan`/`Explore` agents); the `skills:` field preloads content independently of the `Skill` tool.
  - [PubNub — Best practices for Claude Code sub-agents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/) — "PM & Architect are read-heavy" tool scoping.
  - [Developers Digest — Subagent Tool Restrictions](https://www.developersdigest.tech/guides/subagent-tool-restrictions) — restrictions should be structural (the `tools:` allowlist), not instruction-only.
  - [DEV Community — Separation of Planning and Execution](https://dev.to/varun_pratapbhardwaj_b13/separation-of-planning-and-execution-the-key-pattern-for-reliable-ai-coding-agents-5b53) — a plan must fix files, behavior change, tests, and order up front, since execution reinterprets anything left unconstrained. Source of the Owned-paths/Depends-on task table.
  - [Promptessor — Best Claude Code Subagents 2026](https://promptessor.com/blog/best-claude-code-subagents-and-custom-agent-examples-for-specialized-coding-workflows-in-2026) — the human approval gate belongs between Plan and Execute, not before planning.
  - Root [`CLAUDE.md`](../../CLAUDE.md) and the four package `AGENTS.md` files — source of the "read specs/INSIGHTS.md before code" step and the Do-not-touch list.

## implementer

- **Input:** one task row from an `implementation-planner`-authored plan file
  (task ID, AC IDs, Owned paths, Depends-on, Skills to use, Verification).
- **Output:** code changes confined to that task's Owned paths, plus a
  report (task ID, files touched, skills applied, test/typecheck
  command + result, deviations from plan) returned as text.
- **Permissions:** full read/write/`Bash`/`Skill`/`Agent` — but scope is
  self-imposed to one task's Owned paths; explicitly excludes reviewing
  architecture, security, or code outside those paths.
- **Sources its rules are based on:**
  - [Claude Code docs — Create custom subagents](https://code.claude.com/docs/en/sub-agents) — implementation-type agents get `Edit`/`Write`/`Bash`; skills can be preloaded via `skills:` so nothing needs manual `Skill` invocation for the common case.
  - [PubNub — Best practices for Claude Code sub-agents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/) — "Implementer gets Edit/Write/Bash plus testing" tool scoping.
  - [Claude Code docs — Code review](https://code.claude.com/docs/en/code-review) — agents review only what changed, not the whole codebase; pre-existing issues are out of scope.
  - [HAMY — 9 Parallel AI Agents That Review My Code](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents) — security/architecture review must be a separate, dedicated pass, not folded into the author's own self-check.
  - [`docs/agent-prompts/general-reviewer.md`](../../docs/agent-prompts/general-reviewer.md) — this repo's own precedent for "flag only what this diff introduced or worsened," reused as the shape of the Done-condition self-check.
  - `server/`, `client/`, `reviewer-core/` `AGENTS.md`/`README.md`/code (container.ts DI, `SecretsProvider`, `groundFindings()`, per-package test/typecheck commands) — source of the Per-module conventions and exact test commands, verified directly against the code rather than assumed.

## test-writer

- **Input:** existing code in `client/`, `server/`, or `reviewer-core/` that
  needs a dedicated test-writing pass.
- **Output:** test files in that package's required location, plus a report of
  scenarios covered, skills applied, verification commands, omissions, and
  blockers.
- **Permissions:** read access across the repo plus `Edit`/`Write` restricted
  by instruction to test files, and `Bash`/`Skill` for test execution and
  package-specific guidance. Never edits code under test and has no `Agent`.
- **Sources its rules are based on:**
  - [Testing Implementation Details — Kent C. Dodds](https://kentcdodds.com/blog/testing-implementation-details) — tests should assert behavior visible to a user of the code, not implementation details.
  - [Write fewer, longer tests — Kent C. Dodds](https://kentcdodds.com/blog/write-fewer-longer-tests) — source of the typological, workflow-oriented test shape.
  - [No Cheating: Isolated Specification Testing with Claude Code — codecentric](https://www.codecentric.de/en/knowledge-hub/blog/dont-let-your-ai-cheat-isolated-specification-testing-with-claude-code) — supports separating test authorship from implementation.
  - [Test Writer Agent — claude-code-ultimate-guide](https://github.com/FlorianBruniaux/claude-code-ultimate-guide/blob/main/examples/agents/test-writer.md) — precedent for test-only prompt scoping with read/write/test tools.
  - [Life as an engineer: Claude Code Subagents](https://blog.khangnguyen.me/2025/09/claude-code-subagents.html) — precedent for one tester spanning frontend and backend.
  - [Claude Code Unit Tests: Build a Test-Writing Skill — localskills.sh](https://localskills.sh/blog/claude-code-skill-writing-tests) — source of behavior-named tests and repository-specific placement rules.

## architecture-reviewer

- **Input:** a diff, module, or named paths whose architectural boundaries
  should be audited.
- **Output:** grounded `CRITICAL` / `HIGH` / `MEDIUM` findings with a verified
  `file:line`, rule, evidence, and concrete failure mechanism, plus clean and
  unverified checks.
- **Permissions:** strictly read-only `Read`/`Glob`/`Grep` and read-only
  `Bash`; no `Edit`, `Write`, `Skill`, or `Agent`. Reports findings but never
  fixes, approves, or rejects.
- **Sources its rules are based on:**
  - [Code Review for Claude Code](https://claude.com/blog/code-review) — severity-ranked findings remain advisory; approval is a human decision.
  - [Orchestrating AI Code Review at scale — Cloudflare](https://blog.cloudflare.com/ai-code-review/) — source of bounded, structured findings instead of speculative warning volume.
  - [9 Parallel AI Agents That Review My Code — HAMY](https://hamy.xyz/blog/2026-02_code-reviews-claude-subagents) — requires severity and specific file:line evidence.
  - [LLM Hallucinations in AI Code Review — Diffray](https://diffray.ai/blog/llm-hallucinations-code-review/) — grounding in retrieved evidence is the primary hallucination mitigation.
  - [How we built our multi-agent research system — Anthropic](https://www.anthropic.com/engineering/multi-agent-research-system) — precedent for a separate citation pass that re-checks claims.
  - [Severity-Gated Review](https://xpromx.me/knowledge/severity-gated-review) — reviewers surface concerns with concrete verification; humans decide outcomes.

## plan-verifier

- **Input:** a completed implementation, its `implementation-planner`-authored
  Development Plan under `docs/plans/**`, and the approved source spec named
  by that plan.
- **Output:** one evidenced status row for every source-spec `AC-N` and every
  task Verification criterion, owned-path/dependency checks, and a mechanical
  `COMPLETE` or `INCOMPLETE` verdict.
- **Permissions:** strictly read-only `Read`/`Glob`/`Grep` plus `Bash` for
  inspection and the plan's named verification commands; no `Edit`, `Write`,
  `Skill`, or `Agent`. Never fixes a failed criterion.
- **Sources its rules are based on:**
  - [Building Effective AI Agents — Anthropic](https://www.anthropic.com/research/building-effective-agents) — source of the separate evaluator-optimizer workflow for clear criteria.
  - [LLM Evaluators Recognize and Favor Their Own Generations](https://arxiv.org/abs/2404.13076) — empirical basis for keeping verification separate from implementation.
  - [Adversarial Code Review: Why the Maker Shouldn't Grade the Checker — Augment](https://www.augmentcode.com/guides/adversarial-code-review) — supports zero write authority for the checker.
  - [Code Review — Claude Code Docs](https://code.claude.com/docs/en/code-review) — behavior claims require source evidence, and fixing is a separate step.
  - [How to Write Acceptance Criteria an AI Agent Can Actually Verify — Braingrid](https://www.braingrid.ai/blog/how-to-write-acceptance-criteria-ai-agent-can-verify) — acceptance criteria must be checked individually rather than summarized.
  - [When AIs Judge AIs: Agent-as-a-Judge Evaluation for LLMs](https://arxiv.org/abs/2508.02994) — supports criteria-driven, itemized judgment over outcome-only scoring.

## doc-writer

- **Input:** an implemented feature or change described by a Development Plan,
  diff, or other source material.
- **Output:** grounded documentation in the repository's designated location,
  Mermaid diagrams where useful, index updates, and a report of placement,
  evidence, diagrams, and claims that could not be verified.
- **Permissions:** read access across the repo plus `Edit`/`Write` restricted
  by instruction to the documentation locations in its placement table, and
  read-only `Bash`/`Skill`. Never writes product code, `INSIGHTS.md`, or
  `docs/plans/**`, and has no `Agent`.
- **Sources its rules are based on:**
  - [Diátaxis — Start here](https://diataxis.fr/start-here/) — source of the documentation-mode distinction behind the placement tie-breaker.
  - [What is Diátaxis and should you be using it? — I'd Rather Be Writing](https://idratherbewriting.com/blog/what-is-diataxis-documentation-framework) — supports using the framework as guidance while following the repo's actual layout.
  - [Docs as Code — Write the Docs](https://www.writethedocs.org/guide/docs-as-code/) — basis for versioned, reviewable text documentation.
  - [Include diagrams in your Markdown files with Mermaid — The GitHub Blog](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/) — source for native Mermaid diagrams in Markdown.
  - [Flowcharts Syntax — Mermaid](https://mermaid.js.org/syntax/flowchart.html) — source of the syntax constraints encoded in the diagram rules.
  - [AI hallucinations and accurate documentation — Mintlify](https://www.mintlify.com/library/ai-hallucinations) — supports grounding documented claims in verified code.
