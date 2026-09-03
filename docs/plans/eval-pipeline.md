# Development Plan: Eval Pipeline (L06)

## Source Specification

- Path: `specs/2026-09-01-eval-pipeline.md`
- Spec ID: `SPEC-2026-09-01-eval-pipeline`
- Status: `approved`

48 acceptance criteria (AC-1…AC-48, including AC-37…AC-48 which resolve
OQ-1…OQ-12 and are equally binding). This plan maps every AC onto at least one
task; no AC is orphaned and every task cites at least one AC (see **AC
Coverage** at the end).

## Context

DevDigest versions every agent config change (`agent_versions`) but has no way
to measure whether an edit made a reviewer better or worse. The DB tables
(`eval_cases`, `eval_runs`) and every Zod contract this feature needs
(`EvalCaseInput`, `EvalCase`, `EvalRun`, `EvalRunRecord`, `EvalRunResult`,
`EvalTrendPoint`, `EvalDashboard`, `EvalOwnerKind`, `EvalPerTrace`) already
exist and are frozen — **this plan introduces zero schema and zero contract
changes** (G-7, AC-36). It stands up the missing `eval` server module (routes +
service + repository, onion-architecture full split — the module coordinates
multiple sources: the review engine, agents, skills, and its own tables) and
replaces three client stubs: the `/eval` `FeaturePlaceholder`, the Evals-tab gap
in `AgentEditor`/`SkillEditor`, and `FindingCard`'s missing "Turn into eval
case" action.

## Implementation Recommendations

Four load-bearing HOW-level decisions the spec leaves implicit; none changes
any AC's observable behavior.

1. **`eval_runs.actual_output` stores the scored result, not just raw
   findings.** The jsonb column has no shape constraint at the DB level and
   `EvalRunRecord.actual_output` is `z.unknown()` — so at run time the service
   persists `{ produced: Finding[], per_trace: EvalPerTrace[] }` (T2's
   `scoreCase` output), not a bare `Finding[]`. This makes `traces_passed`/
   `traces_total` readable straight off a stored row
   (`per_trace.filter(t=>t.pass).length` / `per_trace.length`) at dashboard
   time with **no re-scoring and no lossy reconstruction** — reconstructing
   `traces_passed` from `round(recall * traces_total)` alone (an alternative
   considered and rejected) can disagree with the original count under
   floating-point rounding, and re-scoring an old run against a
   *since-edited* `expected_output` would silently rewrite history.
   `eval_cases`/`eval_runs` have no columns for `traces_passed`/`traces_total`
   themselves (confirmed against `eval.ts:7-35`), so this is the only place
   they can live.
2. **Bulk runs are tracked in memory via a bespoke tracker, not `JobRunner`.**
   `JobRunner`/the `jobs` table (`server/src/platform/jobs.ts`,
   `server/src/db/schema/ops.ts:6-27`) is real, already-wired infrastructure
   used by `repos`/`repo-intel` for exactly this "enqueue → return an id →
   poll" shape, and was seriously considered. It was **rejected** for this
   feature because AC-47 names a *specific* different precedent to follow —
   "following the existing `POST /pulls/:id/review` pattern
   (`server/INSIGHTS.md:47-48`)" — and that pattern is `reviews/service.ts`'s
   bespoke fire-and-forget (`void this.executor.executeRuns(...)`,
   `service.ts:133`), not `JobRunner`. `JobRunner`'s retry/timeout also wraps
   the *whole* job rather than each unit of work, which would need extra
   unwinding to satisfy AC-14's "one case's failure doesn't abort the batch"
   in a way the reviews-style per-case try/catch gets for free. Since
   `eval_runs` has no `status` column (unlike `agent_runs`) and AC-36 forbids
   adding one, there is nowhere to persist an in-flight placeholder row
   either way — so the bulk-run tracker is a small in-process `Map` (mirrors
   `server/src/platform/sse.ts`'s `runBus` in spirit, far simpler: no SSE,
   just poll-a-status-object), keyed by
   `` `${owner_kind ?? 'workspace'}:${owner_id ?? 'all'}` ``. This satisfies
   AC-47 without touching `db/migrations/` and without adopting a
   differently-precedented mechanism.
3. **A skill's eval cases run through its linked agent's *whole* current
   config** (system prompt, model, strategy, and every currently-enabled
   linked skill — not just the skill under test in isolation). AC-42 says "as
   the run's systemPrompt/model source"; AC-7 says "execute the case's owner
   configuration" — reading these together, the most defensible
   implementation is "run it exactly as that agent runs in production today,"
   which also lets the service reuse one `buildRunConfig` for both owner
   kinds instead of forking skill-only prompt assembly.
4. **A seeded case's `input_diff` must be validated, not just sliced.**
   `sliceDiff(diff, path)` (`reviewer-core/src/review/reduce.ts:58-72`,
   confirmed by reading it) returns the **entire raw diff**, not an empty
   string, when `path` doesn't match any `diff --git … b/<path>` line *and*
   isn't found in `diff.files` — a silent "seed with everything" failure
   mode. `eval/helpers.ts` must reject the seed (`ValidationError`) when the
   slice doesn't actually narrow to the finding's file, verified by checking
   the sliced text still starts with `diff --git a/<file> b/<file>` for that
   exact file (cheap, no `groundFindings` call needed for this specific
   check — grounding is a heavier tool reserved for AC-10/AC-38's citation
   accuracy, not this shape check). This is the spec's own Edge Cases
   requirement ("must be rejected at seed time, not at run time").

## Execution Mode

Multi-agent (parallel implementer instances) — source: planner decision.
Phase 1's three domain tasks (T1, T2, T4) have disjoint owned paths and no
dependency edge between them, and Phase 4-6's client branches split the same
way after their shared prerequisite lands (T9 and T12 after T8; T10 and T11
after T8+T9) — see **Task Dependency Graph** below for the exact edges that
make each pair parallel-safe; every other task is a single link in a
strictly sequential chain.

## Affected Modules & Contracts

- **server** — new `modules/eval/` (full split: `repository.ts`, `scorer.ts`,
  `dashboard.ts`, `run-tracker.ts`, `service.ts`, `routes.ts`, `constants.ts`,
  `errors.ts`); one entry added to `modules/index.ts`; two type aliases added to
  `db/rows.ts` (`EvalCaseRow`, `EvalRunRow`) following the existing convention
  there; `.claude/skills/onion-architecture/LAYER_MAP.md` gains one new `eval`
  row (the skill's own living-doc requirement). No other server module is
  modified.
- **client** — new shared `components/eval-case-editor/EvalCaseEditor/` and
  `components/eval-tab/EvalsTab/`; new `app/eval/_components/` (overview, owner
  detail, compare modal); edits to `FindingCard.tsx` (+ helpers/constants), both
  editors' `constants.ts` + top-level `.tsx` (add the `evals` tab), and
  `app/eval/page.tsx` (replace the placeholder); new `lib/hooks/eval.ts`.
  `client/messages/en/eval.json` already has `dashboard`/`caseEditor`/
  `evalsTab`/`page` keys pre-seeded (scaffolding for this lesson) — extend, do
  not replace them. `client/src/vendor/ui/nav.ts` already has the "Eval
  Dashboard" nav entry (`nav.ts:35`) — **do not touch it** (AC-35 is satisfied
  by verifying this, not by editing it).
- **reviewer-core** — untouched; consumed only, via
  `reviewPullRequest`/`sliceDiff`/`parseUnifiedDiff` exactly as `reviews/`
  already does. `grounding.ts` is not imported directly (do-not-touch,
  AC-10/AC-38 read `ReviewOutcome.review.findings`/`ReviewOutcome.dropped`,
  which the engine already computes; the seed-validation check in
  Implementation Recommendations #4 is a plain string check, not a
  `groundFindings` call).

### Contract changes — **none**

Every shape this feature returns or accepts already exists in
`server/src/vendor/shared/contracts/{eval-ci,knowledge,findings}.ts` (verified
by reading all three files in full). In particular:

- The cross-owner overview (AC-31) is served as `z.array(EvalDashboard)` —
  reusing the existing per-owner shape, not a new one.
- The "Turn into eval case" seed (AC-27) is served as an `EvalCaseInput` —
  the client pre-fills the editor with it; nothing new is returned.
- `FindingActionKind` (`findings.ts:82`) stays exactly
  `['accept','dismiss','learn','reply']` — the seed action is its own route,
  never routed through `POST /findings/:id/:action` (AC-29).
- **`AgentVersion`/`AgentVersionConfig` do not exist in the client's vendor
  copy** — confirmed by diffing `server/src/vendor/shared/contracts/
  knowledge.ts` against `client/src/vendor/shared/contracts/knowledge.ts`:
  both types (`knowledge.ts:239-257` server-side) are entirely absent from
  the client file. AC-34/AC-41 still need the client to consume `GET
  /agents/:id/versions/:version`'s response shape, so T13/T14 must **not**
  `import type { AgentVersion } from "@devdigest/shared"` client-side —
  define a small local TypeScript interface matching the wire shape instead
  (see T13/T14 notes). This is a real, pre-existing drift between the two
  vendored copies, not something this plan is permitted to fix (fixing it
  would mean editing `client/src/vendor/shared/**`, explicitly do-not-touch
  here per the spec's Non-goals).

## Architecture Notes

Onion layers touched (see `.claude/skills/onion-architecture/`):

- **Presentation** — `eval/routes.ts`: Zod params/body via `IdParams` and new
  local schemas, calls the service, serializes. No SQL, no scoring logic.
- **Application** — `eval/service.ts` orchestrates: resolves the owner's run
  config (agent, or an enabled agent linked to a skill), calls
  `reviewPullRequest` (reviewer-core), calls `scorer.ts` (pure), calls
  `repository.ts` to persist, calls `dashboard.ts` (pure) to aggregate reads,
  and drives `run-tracker.ts` for bulk runs. `service.ts` never imports
  `db`/`schema` directly.
- **Infrastructure** — `eval/repository.ts` is the only file touching
  `db`/`schema` for `eval_cases`/`eval_runs`. `eval/run-tracker.ts` is a
  process-local adapter (in-memory `Map`), not DB-backed (Implementation
  Recommendations #2).
- **Domain** — `eval/scorer.ts` (matching, recall/precision/citation-accuracy
  math, pass rule, per-trace) and `eval/dashboard.ts` (trend/delta/alert math)
  are pure functions with zero I/O — same shape discipline as
  `smart-diff/assemble.ts` and `blast/assemble.ts` — even though they live
  inside `modules/eval/` rather than `reviewer-core/` (they are eval-specific
  scoring rules, not general review-engine logic, so they don't belong in the
  do-not-touch `reviewer-core/src/grounding.ts`).

Verified facts this plan depends on (do not re-derive; re-check only if a
referenced file changed):

- `eval_cases` (`server/src/db/schema/eval.ts:7-20`): `id, workspaceId
  (FK cascade), ownerKind ('skill'|'agent'), ownerId (uuid, NO FK — confirmed,
  line 13), name, inputDiff (nullable text), inputFiles (jsonb), inputMeta
  (jsonb), expectedOutput (jsonb), notes`. `eval_runs`
  (`eval.ts:22-35`): `id, caseId (FK cascade onDelete), ranAt (default now,
  notNull), actualOutput (jsonb), pass (nullable boolean), recall/precision/
  citationAccuracy (nullable doublePrecision), durationMs (nullable int),
  costUsd (nullable doublePrecision)`. Both fully covered by
  `0000_init.sql:116-140` + FKs at `:376-377` — `pnpm db:generate` after this
  feature must emit nothing new (AC-36).
- `reviews.agentId` is `uuid('agent_id')` with **no** `.references()`
  (`server/src/db/schema/reviews.ts:30`) — confirmed nullable/FK-less, which is
  what makes AC-30 ("no resolvable owning agent") a real case, not
  hypothetical.
- `reviewPullRequest(input: ReviewInput): Promise<ReviewOutcome>`
  (`reviewer-core/src/review/run.ts:59-136,146-250`) — `ReviewOutcome.review`
  is the **grounded** `Review` (`findings` already survived the citation gate);
  `ReviewOutcome.dropped: { finding, reason }[]` is what the gate removed.
  `citation_accuracy = kept / (kept + dropped)` is therefore just
  `outcome.review.findings.length / (outcome.review.findings.length +
  outcome.dropped.length)` — **no re-run of `groundFindings` needed** for
  scoring (the spec's Edge Cases section explicitly warns against
  re-grounding for this purpose: it would always yield 1.0).
  `reviewer-core/src/prompt.ts`'s `assemblePrompt` already wraps the `diff` in
  `<untrusted source="diff">…</untrusted>` and appends `INJECTION_GUARD` to the
  system message unconditionally — calling `reviewPullRequest` the same way
  `run-executor.ts:302-348` does satisfies the injection-hardening NFR for
  free; no extra wrapping code needed in `eval/`.
  `sliceDiff(diff: UnifiedDiff, path: string): string`
  (`reviewer-core/src/review/reduce.ts:58-72`, re-exported
  `reviewer-core/src/index.ts:39`) is what AC-27 slices the PR diff with —
  **confirmed by reading its source** that it falls back to `diff.raw` (the
  whole diff) when `path` isn't found; see Implementation Recommendations #4
  for the required guard.
  `parseUnifiedDiff(raw: string): UnifiedDiff`
  (`server/src/adapters/git/diff-parser.ts:14`, exported via
  `server/src/adapters/index.ts:9`) is what turns a case's stored `input_diff`
  string back into the `UnifiedDiff` `reviewPullRequest` needs.
- `container.reviewRepo` (`server/src/platform/container.ts:112-114`) exposes
  `getPull`, `getRepo`, `getPrFiles`, and `findingContext(findingId):
  Promise<{ finding: FindingRow; review: ReviewRow; pull: PullRow } |
  undefined>` (`server/src/modules/reviews/repository/review.repo.ts:103-117`)
  — exactly what AC-27/AC-30's seed route needs (finding → its review →
  `review.agentId` (nullable) → its PR → `getRepo(pull.repoId)` →
  `loadDiff`-style diff → `sliceDiff`). Reuse this rather than adding a new
  reviews-side method.
- `container.agentsRepo.getById/linkedSkills` (`agents/repository.ts:65-71,
  192-200`) and `container.skillsRepo.agentsForSkill(workspaceId, skillId):
  Promise<{agentId,agentName,order}[]>` (`skills/repository.ts:173-180`, already
  exposed at `GET /skills/:id/agents`) resolve an owner's run config — the
  latter does **not** filter by `agents.enabled`, so `eval/service.ts` must
  fetch each candidate via `agentsRepo.getById` and pick the first with
  `enabled === true` itself (AC-42).
  `AgentVersionConfig`/`AgentVersion` (server-side only — see Contract
  changes above) + `GET /agents/:id/versions` / `GET
  /agents/:id/versions/:version` (`agents/routes.ts:129-145`,
  `knowledge.ts:239-257`) are what the client-side version-label inference
  (AC-46) and the Compare modal (AC-34) read — no server change needed there.
  `PUT /agents/:id` (`agents/routes.ts:111-120`, `UpdateAgentBody`) does **not**
  accept `skills` — Promote (AC-41) must call it for
  provider/model/system_prompt/output_schema/strategy/ci_fail_on/repo_intel,
  **and separately** call `POST /agents/:id/skills` with
  `{ skill_ids: version.config.skills }` to restore the linked-skill set. Two
  calls, not one.
- `agent.strategy ?? 'single-pass'` mirrors `run-executor.ts:309`'s pattern;
  reuse `REVIEW_STRATEGY` from `reviews/constants.ts:12` (cross-module constant
  import, same precedent as `blast/` reusing `repo-intel/constants.ts`).
- `server/src/platform/jobs.ts`'s `JobRunner` and `server/src/db/schema/
  ops.ts:6-27`'s `jobs` table are real and already wired into `container.jobs`
  (`container.ts:66,93`), used today by `repos/service.ts` and
  `repo-intel/routes.ts` — confirmed by reading both. Deliberately **not**
  reused here; see Implementation Recommendations #2.
- Client: `useSmartDiff` (`client/src/lib/hooks/smart-diff.ts`) is the exact
  `useQuery` template for every read hook in `lib/hooks/eval.ts`.
  `client/messages/en/eval.json` already ships `dashboard.*`, `caseEditor.*`,
  `evalsTab.*`, `page.*` keys (pre-seeded scaffolding, confirmed by reading the
  file) — extend with owner-picker/orphan/compare/overview keys, keep every
  existing key and its wording.
  `FindingCard.tsx` currently renders only Accept/Dismiss (`FindingCard.tsx:98-
  119`, the starter's documented subset of the mockup's five actions) — add a
  third ghost button, not a redesign of the row.

Relevant INSIGHTS entries:

- `server/INSIGHTS.md:31-32` — never hand-write migrations; this plan needs
  none, and T1's verification re-checks that with `pnpm db:generate`.
- `server/INSIGHTS.md:36-37` — when `ReviewOutcome` is destructured, check every
  field is actually used; `eval/service.ts`'s `runCase` must keep `costUsd`,
  `durationMs`(computed locally), `review`, and `dropped` — don't silently drop
  one the way `run-executor.ts` once dropped `costUsd`.
- `server/INSIGHTS.md:47-48` — `POST /pulls/:id/review` is fire-and-forget,
  not synchronous; this is the named precedent AC-47 asks the bulk eval run
  to follow (Implementation Recommendations #2), not `JobRunner`.
- `client/INSIGHTS.md:11-12` — a formatter/helper used by ≥2 component trees
  belongs in a shared location, not colocated. `EvalCaseEditor` and `EvalsTab`
  are both consumed by `AgentEditor` and `SkillEditor`, and the seed flow from
  `FindingCard` also opens `EvalCaseEditor` — hence both are shared components
  under `client/src/components/`, not colocated under one editor's `_components/`.

## Task Dependency Graph

```text
Phase 1 (parallel, disjoint paths, no edges among them): T1, T2, T4
  T1, T2 ──────> T3
  T1, T2, T3, T4 ──> T5 ──> T6 ──> T7 (server .it.test)
  T6 ──> T8 (client hooks)
  T8 ──> T9 (EvalCaseEditor) ; T8 ──> T12 (eval overview page)
      — T9 and T12 depend only on T8, disjoint paths: parallel-safe
  T8, T9 ──> T10 (FindingCard button) ; T8, T9 ──> T11 (EvalsTab)
      — T10 and T11 both need the finished EvalCaseEditor, disjoint paths: parallel-safe once T9 lands
  T12 ──> T13 ──> T14 (owner detail, then compare modal — same growing page, sequential)
  T6, T11, T14 ──> T15 (docs, follow-up — not for implementer)
```

T1, T2, T4 own disjoint files and no dependency edge connects them — safe for
three parallel `implementer` runs. T3 depends on T1 (row shape) and T2 (the
`EvalActualOutput`/per-trace type it reads). T9 and T12 both depend only on T8
and own disjoint paths — parallel-safe. T10 and T11 both depend on T8 **and**
T9 (both need the finished `EvalCaseEditor` component to open it) and own
disjoint paths — parallel-safe once T9 lands, not before. T13→T14 are strictly
sequential (same page, growing surface; T14 needs the run-selection state T13
introduces). Every edge points from a lower task number to a higher one; the
graph has no cycle.

## Phases

### Phase 1: Server domain (pure + data access, no HTTP)

| Task ID | AC IDs | Module | Type | Owned paths | Depends-on | Skills to use | Verification |
|---|---|---|---|---|---|---|---|
| T1 | AC-1, AC-2, AC-5, AC-36 | server | data access | `server/src/db/rows.ts`, `server/src/modules/eval/repository.ts` | — | onion-architecture, drizzle-orm-patterns, postgresql-table-design, typescript-expert | `cd server && pnpm typecheck` exits 0; `pnpm db:generate` (from `server/`) produces **no new file** (`git status --porcelain server/src/db/migrations` empty) — AC-36; repository unit-testable via a `.it.test.ts` added in T7, not here |
| T2 | AC-8, AC-9, AC-11, AC-12, AC-37, AC-40, AC-44, AC-48 | server | domain logic | `server/src/modules/eval/scorer.ts`, `server/src/modules/eval/scorer.test.ts` | — | onion-architecture, typescript-expert, zod | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' src/modules/eval/scorer.test.ts` green with named cases: `matches on file + overlapping line range regardless of severity/category` (AC-8, AC-44), `computes recall and precision independently` (AC-9), `degenerate 0/0 recall and precision both persist as 1` (AC-37), `citation_accuracy is kept/(kept+dropped); null when kept+dropped is 0 but the single-run response reports 1` (AC-10, AC-38), `pass is exactly recall===1 && precision===1` (AC-11, AC-40), `rejects an expected_output that is not an array of {file,start_line,end_line}-shaped objects` (AC-12), `traces_total counts expected_output entries; traces_passed counts matched ones` (AC-48) |
| T3 | AC-16, AC-17, AC-18, AC-19, AC-46 | server | domain logic | `server/src/modules/eval/dashboard.ts`, `server/src/modules/eval/dashboard.test.ts` | T1, T2 | onion-architecture, typescript-expert | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' src/modules/eval/dashboard.test.ts` green with named cases: `builds one trend point per distinct ran_at from latest-per-case state` (AC-46), `delta is current minus the preceding trend point`, `zero runs yields a well-formed zeroed dashboard, not an error` (AC-19), `alert names the worst regressed metric past a 5pt threshold; null otherwise` (AC-18), `citation_accuracy averages only non-null per-case values, defaulting to 1 when none exist` (AC-38 downstream), `recent_runs is the N most recent EvalRunRecord rows, most-recent-first, with no batch grouping` (AC-46) |
| T4 | AC-14, AC-15, AC-47 | server | infra (in-process) | `server/src/modules/eval/run-tracker.ts`, `server/src/modules/eval/run-tracker.test.ts` | — | onion-architecture, typescript-expert | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' src/modules/eval/run-tracker.test.ts` green: `start()` returns a batch id and rejects a second `start()` for the same scope key while one is `running` (409-shaped error, AC-15 server-side half), `recordResult`/`recordError` update progress incrementally, `status()` reports `done` only once every case has resolved (AC-47) |

T1 notes — add to `db/rows.ts` (same convention as the existing 9 entries):
`export type EvalCaseRow = typeof t.evalCases.$inferSelect;` and
`export type EvalRunRow = typeof t.evalRuns.$inferSelect;`. `repository.ts`
exposes: `list(workspaceId, filter?: {ownerKind,ownerId})`, `getById(workspaceId,
id)`, `insert(values)`, `update(workspaceId, id, patch)`,
`deleteById(workspaceId, id)` (cascade to `eval_runs` is automatic via the
existing FK, AC-5 — no code needed, only a T7 test proving it), `insertRun(caseId,
result)`, and dashboard reads: `listRunsForDashboard(scope: {workspaceId,
ownerKind?, ownerId?}): Promise<DashboardRunRow[]>` — one query, joined against
`eval_cases` for `name`/`ownerKind`/`ownerId`/`expectedOutput` is **not** needed
here (per Implementation Recommendations #1, `per_trace` already lives in
`actual_output`), ordered by `ran_at` ASC, plus `countCases(scope)` for
`cases_total`. Export the `DashboardRunRow` type (`{ case_id, case_name, ran_at,
pass, recall, precision, citation_accuracy, duration_ms, cost_usd,
actual_output }`) — T3 imports it.

T2 notes — `scorer.ts` is pure (no `Container`, no I/O), exporting:
`parseExpectedFindings(raw: unknown): {file,start_line,end_line,...}[]` (throws
a typed `EvalScoringError` on shape mismatch — T5 maps that to `ValidationError`
per AC-12), `matchFindings(expected, produced)` (file + overlapping-range only,
AC-8/AC-44), `scoreCase(expected, outcome: {findings: Finding[]; kept: number;
dropped: number}): { recall, precision, citationAccuracyStored: number | null,
citationAccuracyResponse: number, pass, perTrace: EvalPerTrace[],
tracesPassed, tracesTotal }`. Export `EvalActualOutput = { produced: Finding[];
per_trace: EvalPerTrace[] }` (Implementation Recommendations #1) and a
`buildActualOutput(outcome, score)` helper.

T3 notes — `dashboard.ts` exports `buildDashboard(rows: DashboardRunRow[],
casesTotal: number, ownerKind: EvalOwnerKind | null, ownerId: string | null):
EvalDashboard` implementing exactly the algorithm below (this is the one place
in the plan doing real math — follow it precisely, don't improvise a different
one):
1. Sort `rows` by `ran_at` ascending (repository already does this; re-sort
   defensively since this function is unit-tested standalone).
2. Walk rows, maintaining `latestByCase: Map<case_id, DashboardRunRow>`. After
   processing every row sharing one exact `ran_at` timestamp, snapshot
   `latestByCase.values()` into one aggregate point (see step 3) and push it to
   `trend` (dedup — one point per distinct `ran_at`, not one per row).
3. Aggregate a snapshot: `recall`/`precision` = mean across the snapshot's
   rows (always numeric per AC-37); `citation_accuracy` = mean of rows whose
   stored `citation_accuracy` is non-null, or `1` if none are non-null;
   `pass_rate` = fraction with `pass === true`; `cost_usd` = sum of non-null
   `cost_usd`, or `null` if no row has one.
4. `current` = last trend point's aggregate plus `traces_passed`/`traces_total`
   summed from `latestByCase`'s rows' `actual_output.per_trace`.
5. `delta` = `current` minus the second-to-last trend point (zeroed if `trend`
   has < 2 points) for `recall`/`precision`/`citation_accuracy` only (per
   `EvalDashboard.delta`'s shape).
6. `recent_runs` = last `EVAL_RECENT_RUNS_LIMIT` (constant, `20`) rows,
   most-recent-first, mapped to `EvalRunRecord`.
7. `alert`: null if `trend.length < 2`; else compute each metric's
   `current - previous`, take the most negative; if it's `< -0.05`, format
   `"<Metric> dropped <N>pt (<prev%> → <curr%>)"`; else null.
8. Zero-run input (AC-19): `cases_total` from the parameter (may be > 0 even
   with zero runs), everything else zeroed/empty exactly as the fields'
   defaults, `alert: null`.

T4 notes — `run-tracker.ts` is a tiny class-or-module-level `Map<string,
BatchState>` where `BatchState = { total, completed, results: EvalRunResult[],
errors: {case_id, message}[], status: 'running'|'done' }`. `start(scopeKey,
total)` throws a typed `EvalRunInProgressError` if an entry for `scopeKey` is
already `'running'` (T5 maps this to `ConflictError`, 409 — AC-15's server-side
guard for concurrent bulk runs on one owner). Not persisted; a server restart
mid-batch simply loses progress (acceptable — no `eval_runs` row is ever
half-written since each case's row is inserted only on that case's success).

### Phase 2: Server service + routes

| Task ID | AC IDs | Module | Type | Owned paths | Depends-on | Skills to use | Verification |
|---|---|---|---|---|---|---|---|
| T5 | AC-1, AC-2, AC-3, AC-4, AC-7, AC-10, AC-13, AC-14, AC-15, AC-16, AC-17, AC-19, AC-27, AC-28, AC-29, AC-30, AC-31, AC-38, AC-39, AC-40, AC-42, AC-47 | server | backend | `server/src/modules/eval/service.ts`, `server/src/modules/eval/constants.ts`, `server/src/modules/eval/helpers.ts`, `server/src/modules/eval/errors.ts` | T1, T2, T3, T4 | onion-architecture, fastify-best-practices, typescript-expert | `cd server && pnpm typecheck` exits 0; `grep -rn "drizzle-orm\|from '../../db/schema" server/src/modules/eval/service.ts` returns no matches (service never imports Drizzle directly — dependency-inversion check) |
| T6 | AC-1, AC-2, AC-4, AC-6, AC-7, AC-13, AC-16, AC-17, AC-27, AC-29, AC-31, AC-42, AC-47 | server | backend | `server/src/modules/eval/routes.ts`, `server/src/modules/index.ts`, `.claude/skills/onion-architecture/LAYER_MAP.md` | T5 | onion-architecture, fastify-best-practices, zod | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck` green; `grep -n "FindingActionKind" server/src/modules/eval/routes.ts` returns no matches (AC-29 — seed route never extends/reuses the finding-action enum); `LAYER_MAP.md`'s module table gains one `eval` row classified "Full split", per the onion-architecture skill's own instruction to keep that file current when a module is added |

T5 notes — public surface: `listCases(workspaceId, filter?)`,
`getCase(workspaceId, id)`, `createCase(workspaceId, input: EvalCaseInput)`
(validates `owner_id` is a uuid resolving to an existing agent/skill in the
workspace per `owner_kind` — AC-3 — via `agentsRepo.getById`/`skillsRepo.getById`,
throws `ValidationError`/`NotFoundError`; persists nothing on failure),
`updateCase`, `deleteCase` (all workspace-scoped, 404 on cross-workspace/missing
— AC-4), `runCase(workspaceId, caseId): Promise<EvalRunResult>` (synchronous —
AC-7: parse `input_diff` via `parseUnifiedDiff`, `parseExpectedFindings` via T2
— on failure, `ValidationError`, **no** `eval_runs` row, AC-12 — resolve owner
run config via `buildRunConfig` below, call `reviewPullRequest`, call
`scoreCase`, persist via `repository.insertRun`, return `EvalRunResult` with
`result.citation_accuracy` = the **response** value from T2 (never the stored
null, AC-38)), `startBulkRun(workspaceId, {ownerKind?, ownerId?}):
{batch_id, total}` (resolves the case set — one owner's or the whole
workspace's, AC-43 — calls `runTracker.start`, fires `void this.runBulk(...)`
unawaited exactly like `reviews/service.ts:133`'s `runReview`, catches/logs;
each case failure is caught individually and recorded via
`runTracker.recordError` — AC-14 — the loop never aborts), `bulkRunStatus(batchId)`,
`getDashboard(workspaceId, {ownerKind?, ownerId?})` (delegates to
`repository.listRunsForDashboard` + `countCases` + `dashboard.buildDashboard`
— AC-16/17/19), `getOverview(workspaceId): EvalDashboard[]` (one entry per
distinct owner that has ≥1 eval case in the workspace — AC-31), and
`seedFromFinding(workspaceId, findingId): EvalCaseInput` (AC-27/28/30): read
`container.reviewRepo.findingContext(findingId)`, 404 if missing or wrong
workspace (`ctx.pull.workspaceId !== workspaceId`); `owner_kind` is always
`'agent'` (findings only come from agent reviews); `owner_id = review.agentId
?? ''` (empty string when null — AC-30's "no resolvable owning agent"; T9's
editor must require the user to pick a real owner before save, and `createCase`'s
existing AC-3 validation independently rejects an empty/invalid `owner_id` at
save time as defense in depth); load the diff via `getRepo(pull.repoId)` +
the same `loadDiff`-equivalent (reuse `diffFromPrFiles`-style fallback or a
thin local copy — **do not** import `reviews/diff-loader.ts` directly since
it's `reviews`-module-private; add an equivalent 15-line helper in
`eval/helpers.ts` calling `container.git.diff` then falling back to
`repo.getPrFiles`, mirroring `diff-loader.ts`'s two branches) then
`sliceDiff(diff, finding.file)`; **validate the slice per Implementation
Recommendations #4** — reject with `ValidationError` at seed time (not run
time) when the sliced text does not begin with `diff --git a/<finding.file>
b/<finding.file>` for that exact file, catching both `sliceDiff`'s
whole-raw-diff fallback and the spec's Edge Cases scenario (a full-file
`kind` finding whose file has no diff hunks); `expected_output` is `[]`
when `finding.dismissedAt != null` (negative case) else `[{severity, category,
title, file, start_line: finding.startLine, end_line: finding.endLine}]`
(positive case) — mirrors `findingToSeed` in the design reference 1:1.

`buildRunConfig(workspaceId, ownerKind, ownerId)` (private): for `'agent'`,
`agentsRepo.getById` (404 if missing); for `'skill'`, `skillsRepo.getById` (404
if missing) then `skillsRepo.agentsForSkill` → for each candidate (order asc)
`agentsRepo.getById`, return the first `enabled === true` one, else throw
`EvalOwnerUnavailableError` (`errors.ts`, `AppError` subclass, code
`eval_owner_unavailable`, 422 — AC-42, distinguishable client-side from a
generic 4xx so the UI can show "Link this skill to an agent to run its
evals" instead of a toast). Either way, returns the resolved `AgentRow` plus
its enabled linked-skill bodies (same `linkedSkills().filter(enabled).map(...)`
+ `wrapUntrusted` for non-manual/extracted sources as `run-executor.ts:252-259`
— copy that one block, don't import it, since `run-executor.ts` is
`reviews`-module-private). `runCase` calls `reviewPullRequest({ systemPrompt:
agent.systemPrompt, model: agent.model, diff, llm: await
container.llm(agent.provider), strategy: agent.strategy ?? REVIEW_STRATEGY,
skills: skillBodies (only when non-empty), task: `Evaluate eval case
"${case.name}"`, sessionId: `eval:${case.id}` })` — no repo-intel/context/
callers/specs/intent enrichment (eval cases are diff-only fixtures, not tied to
a real PR).

T6 notes — routes (all under `getContext`-resolved workspace):
`POST /eval-cases`, `GET /eval-cases` (query: `owner_kind`, `owner_id`, both
optional — AC-2), `GET /eval-cases/:id`, `PUT /eval-cases/:id`,
`DELETE /eval-cases/:id`, `POST /eval-cases/:id/run`,
`POST /eval-cases/run-all` (body: `{owner_kind?, owner_id?}` — AC-13 when both
present, AC-43 "Run all agents" when both absent), `GET
/eval-cases/run-all/:batchId`, `GET /eval-dashboard` (query: `owner_kind?,
owner_id?`), `GET /eval-dashboard/overview`, `POST /findings/:id/eval-seed`.
Register `eval` in `modules/index.ts` (one import + one entry, per its
documented "ADD A MODULE" recipe) — AC-6. Update `LAYER_MAP.md`'s module
table with one new row: `eval | Full split | routes, service, repository,
scorer, dashboard, run-tracker, constants, errors | Coordinates the review
engine, agents, skills, and its own tables — same graduated-layering shape as
blast/smart-diff`.

### Phase 3: Server verification

| Task ID | AC IDs | Module | Type | Owned paths | Depends-on | Skills to use | Verification |
|---|---|---|---|---|---|---|---|
| T7 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-16, AC-17, AC-18, AC-19, AC-28, AC-29, AC-30, AC-36, AC-37, AC-38, AC-39, AC-42, AC-44, AC-47, AC-48 | server | test | `server/test/eval.it.test.ts` | T6 | fastify-best-practices, drizzle-orm-patterns, security | `cd server && pnpm exec vitest run test/eval.it.test.ts` green (Docker required); `cd server && pnpm db:generate && git status --porcelain server/src/db/migrations` empty (AC-36, re-verified against the finished module) |

T7 must cover, each as a named case: CRUD + workspace isolation (create in
workspace A invisible/undeletable from workspace B — AC-2, AC-4); invalid
`owner_id` (non-uuid, non-existent, wrong-kind) rejected with nothing persisted
(AC-3); deleting a case cascades its runs (AC-5); a stubbed `MockLLMProvider`
run scoring both a positive and the degenerate `0 expected/0 produced` case
(AC-7, AC-9, AC-11, AC-37); a stubbed provider producing a finding with a
severity/category mismatch still counts as matched (AC-44); an
unparseable/malformed `expected_output` fails with no persisted row (AC-12); a
run producing zero findings persists `citation_accuracy: null` but the
response reports `1` (AC-38); bulk run over 3 cases where the provider throws
on case 2 persists 2 rows, records 1 error, and the batch reaches `status:
'done'` (AC-13, AC-14, AC-47 — poll `GET /eval-cases/run-all/:batchId` to
completion); starting a second bulk run for the same owner while one is
`running` returns 409 (AC-15); dashboard for an owner with zero runs returns a
well-formed zeroed payload, not a 404/500 (AC-19); dashboard workspace-wide
(`owner_kind`/`owner_id` omitted, both null in response — AC-17); a
provider-stub sequence where the second run's recall/precision regress
produces a non-null `alert` naming the metric (AC-18); seeding from an
accepted finding produces a positive case, from a dismissed finding a negative
`expected_output: []` case (AC-27, AC-28); seeding from a finding whose review
has `agentId: null` returns `owner_id: ''` rather than throwing (AC-30);
seeding a finding whose sliced diff falls back to the whole raw diff (e.g. a
full-file-kind finding) is rejected with `ValidationError`, not silently
saved (Implementation Recommendations #4); `git diff --exit-code
server/src/vendor/shared/contracts/findings.ts` shows no change (AC-29 — the
module never touches the frozen enum); an eval case whose `owner_id` doesn't
resolve to any current agent/skill is still returned (read-only) by `GET
/eval-cases` rather than erroring (AC-39's server half — no cascade, still
listed); a skill with no enabled linked agent returns the
`eval_owner_unavailable` error code from `runCase` (AC-42); and one unit-style
assertion inside this file (or a small dedicated test) that an assembled
prompt for a run contains `<untrusted source="diff">` (Non-functional
requirement — Security/prompt injection).

### Phase 4: Client data layer + shared editor

| Task ID | AC IDs | Module | Type | Owned paths | Depends-on | Skills to use | Verification |
|---|---|---|---|---|---|---|---|
| T8 | AC-47 | client | data hooks | `client/src/lib/hooks/eval.ts`, `client/src/lib/hooks/index.ts` | T6 | react-frontend-architecture, react-best-practices, typescript-expert | `cd client && pnpm typecheck` exits 0; every hook (`useEvalCases`, `useEvalCase`, `useCreateEvalCase`, `useUpdateEvalCase`, `useDeleteEvalCase`, `useRunEvalCase`, `useRunAllEvals` + `useBulkRunStatus` (polling via `refetchInterval` while `status==='running'`), `useEvalDashboard`, `useEvalOverview`, `useEvalSeed`) exported from `@/lib/hooks`, mirroring `useSmartDiff`'s `useQuery` shape (`queryKey`, `enabled`, `retry: false` for reads; `useMutation` + query invalidation for writes) |
| T9 | AC-24, AC-25, AC-26, AC-27, AC-30 | client | shared UI | `client/src/components/eval-case-editor/EvalCaseEditor/**`, `client/messages/en/eval.json` | T8 | react-frontend-architecture, react-best-practices, react-testing-library, next-best-practices | `cd client && pnpm exec vitest run src/components/eval-case-editor && pnpm typecheck` green with named cases: `renders Diff / Files / PR meta input views and an Expected output editor` (AC-24), `marks invalid JSON in Expected output and blocks Save` (AC-25), `Run on save executes the case and shows its outcome inline` (AC-26), `blocks Save and prompts for an owner when owner_id is empty` (AC-30), `pre-fills from a passed-in seed prop` (AC-27 wiring) |
| T10 | AC-27, AC-29 | client | feature UI | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`, `.../FindingCard/FindingCard.test.tsx`, `client/messages/en/prReview.json` | T8, T9 | react-frontend-architecture, react-best-practices, react-testing-library | `cd client && pnpm exec vitest run 'src/app/repos/[repoId]/pulls/[number]/_components/FindingCard' && pnpm typecheck` green; new case `activating "Turn into eval case" requests a seed and opens the editor pre-filled` (AC-27) asserting the seed call fires with the finding's id and the editor renders with its returned `name`/`expected_output`; existing Accept/Dismiss cases untouched |

T9 notes — folder shape: `EvalCaseEditor.tsx`, `index.ts`, `styles.ts`,
`helpers.ts` (JSON validation, owner-picker validity), `constants.ts`,
`EvalCaseEditor.test.tsx`, `_components/{InputTabs.tsx, ExpectedOutputEditor.tsx,
RunOnSaveResult.tsx}`. Reuses `client/messages/en/eval.json`'s existing
`caseEditor.*` keys (`nameLabel`, `inputLabel`, `tabs.diff/prMeta`,
`expectedOutput`, `validJson`/`invalidJson`, `lastRunPassed`/`lastRunFailed`,
`resultSummary`) — add only what's missing: an `tabs.files` key (spec's third
input view, `input_files`), an owner-picker section's keys, and a
`runOnSave`/`ownerRequired` key. Props: `{ seed?: EvalCaseInput; caseId?:
string; onClose: () => void }` — editing an existing case passes `caseId`
(loads via `useEvalCase`); creating passes an optional `seed`.

T10 notes — add one more `Button` (kind `ghost`, icon `FlaskConical`, mirroring
`ActionRow`'s "Turn into eval case" in the design reference) between Dismiss
and (nonexistent-here) Reply; wire it to `useEvalSeed(f.id)` on click, then
render `EvalCaseEditor` with the returned seed when the mutation resolves.
Keep `onAction`'s existing `accept`/`dismiss` contract untouched — this is an
additive, independent action, not a new `FindingActionKind` member (AC-29).

### Phase 5: Evals tab (agent + skill editors)

| Task ID | AC IDs | Module | Type | Owned paths | Depends-on | Skills to use | Verification |
|---|---|---|---|---|---|---|---|
| T11 | AC-15, AC-20, AC-21, AC-22, AC-23, AC-24, AC-39, AC-42, AC-45 | client | feature UI | `client/src/components/eval-tab/EvalsTab/**`, `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`, `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`, `client/src/app/skills/[id]/_components/SkillEditor/constants.ts`, `client/src/app/skills/[id]/_components/SkillEditor/SkillEditor.tsx` | T8, T9 | react-frontend-architecture, react-best-practices, react-testing-library, next-best-practices | `cd client && pnpm exec vitest run src/components/eval-tab 'src/app/agents/[id]/_components/AgentEditor' 'src/app/skills/[id]/_components/SkillEditor' && pnpm typecheck` green with named cases: `renders Recall/Precision/Citation accuracy/Traces passed with deltas` (AC-20), `renders every case in exactly one of passing/failing/never-run state` (AC-21), `running one case updates only that row and the metric strip` (AC-22), `Run all evals refreshes every case and the strip on completion` (AC-23), `N/M passing counts never-run cases toward M but not toward pass/fail` (AC-45), `Run and Run all evals are disabled while a run is in flight for this owner` (AC-15), `an orphaned case shows Owner deleted, read-only, and is excluded from Run all evals` (AC-39), `a skill Evals tab with no enabled linked agent disables running and shows the linking hint` (AC-42) |

T11 notes — `EvalsTab` is shared (both editors pass `ownerKind`/`ownerId`/
`ownerName`), folder: `EvalsTab.tsx`, `index.ts`, `styles.ts`, `helpers.ts`
(pass-count denominator per AC-45, orphan/unavailable detection), `constants.ts`,
`EvalsTab.test.tsx`, `_components/{MetricStrip.tsx, CaseRow.tsx}`. `EvalsTab`
opens T9's `EvalCaseEditor` for its "New eval case" and per-case edit controls
(AC-24), which is why T11 depends on T9 as well as T8. Orphan detection
(AC-39): `EvalsTab` receives the already-loaded `agents`/`skills` lists as
props from the editor (both editors already fetch their own list for the
sidebar) and cross-references each case's `owner_id` client-side — no new
endpoint. Add the `evals` tab entry to both `TABS` arrays (after `context`,
before `preview`/`stats` where applicable) and one more ternary branch in each
editor's `.tsx` alongside the existing `skills`/`context` branches
(`AgentEditor.tsx:26-28`'s pattern).

### Phase 6: Eval Dashboard page

| Task ID | AC IDs | Module | Type | Owned paths | Depends-on | Skills to use | Verification |
|---|---|---|---|---|---|---|---|
| T12 | AC-31, AC-35, AC-39, AC-43 | client | route UI | `client/src/app/eval/page.tsx`, `client/src/app/eval/_components/EvalOverview/**` | T8 | react-frontend-architecture, next-best-practices, react-best-practices, react-testing-library | `cd client && pnpm exec vitest run 'src/app/eval' && pnpm typecheck` green: `renders one row per owner with latest run timestamp, pass count, and Recall/Precision/Citation` (AC-31), `Run all agents shows a confirmation naming the total case/LLM-call count before firing` (AC-43); `git diff --exit-code client/src/vendor/ui/nav.ts` shows no change (AC-35) |
| T13 | AC-32, AC-33, AC-34, AC-46 | client | route UI | `client/src/app/eval/_components/EvalOwnerDetail/**` | T12 | react-frontend-architecture, react-best-practices, react-testing-library | `cd client && pnpm exec vitest run 'src/app/eval'` green: `renders the alert banner only when alert is non-null` (AC-32), `renders a metric card with delta+sparkline per metric plus the trend chart and recent-runs table` (AC-32), `Compare enables only when exactly two runs are selected, else shows the hint` (AC-33), `each recent-run row shows a version label inferred from ran_at vs agent_versions` (AC-46) |
| T14 | AC-34, AC-41 | client | route UI | `client/src/app/eval/_components/CompareRunsModal/**` | T13 | react-frontend-architecture, react-best-practices, react-testing-library | `cd client && pnpm exec vitest run 'src/app/eval'` green: `shows old→new deltas for Recall/Precision/Citation/Cost and a system-prompt diff from the two matched agent version snapshots` (AC-34), `Promote asks for confirmation then calls PUT /agents/:id with the version config followed by POST /agents/:id/skills with its skill list` (AC-41); `git diff --exit-code client/src/vendor/shared` shows no change (Contract-drift note — no import of the missing client-side `AgentVersion` type) |

T12 notes — overview rows come from `useEvalOverview()` (T8, hits `GET
/eval-dashboard/overview`, an `EvalDashboard[]`); resolve each row's owner
display name by cross-referencing already-available `useAgents()`/`useSkills()`
lists (existing hooks) against `owner_kind`/`owner_id` — no new endpoint. "Run
all agents" (AC-43) sums `cases_total` across the overview array for the
confirmation copy, then calls `useRunAllEvals()` with no `owner_kind`/`owner_id`
(workspace-wide bulk).

T13 notes — the version-label inference (AC-46) is a pure client helper:
`inferVersionLabel(ranAt: string, versions: AgentVersion[]): string | null` —
latest version whose `created_at <= ranAt`, else null (shown as "—"), where
`AgentVersion` here is the **local** interface defined in T14 (see below), not
an import from `@devdigest/shared`. For a `'skill'` owner, resolve the label
using the **currently**-linked enabled agent's version history (same one
`buildRunConfig` would pick server-side) — document this as a known
approximation for skills whose linked agent changed over time (see Risks).

T14 notes — **define a local `interface AgentVersionSnapshot { agent_id:
string; version: number; config: { provider: string; model: string;
system_prompt: string; output_schema: unknown; strategy: string; ci_fail_on:
string; repo_intel: boolean; skills: string[] }; created_at: string }` in
`CompareRunsModal/helpers.ts`** (mirrors the server's real `AgentVersion`/
`AgentVersionConfig` shape, `knowledge.ts:239-257`, but is **not** imported
from `@devdigest/shared` — the client's vendored copy doesn't have it; see
Contract changes above). T13 imports this same local type for its
`inferVersionLabel` signature rather than declaring a second one. Promote's
two-call sequence (Architecture Notes) must issue the `PUT` before the `POST
/agents/:id/skills` and surface a single combined success/error state, not
two independent toasts.

### Phase 7: Docs (follow-up, not for `implementer`)

| Task ID | AC IDs | Module | Type | Owned paths | Depends-on | Skills to use | Verification |
|---|---|---|---|---|---|---|---|
| T15 | AC-6, AC-31 | docs | docs | `server/README.md`, `client/README.md` | T6, T11, T14 | mermaid-diagram | Every new `eval` route appears in the server API map (AC-6); the client route map notes `/eval`'s real page, no longer "future phase" (AC-31); every added claim cites a real file:line |

T15 should be handed to the `doc-writer` agent, not `implementer`.

## Testing Strategy

- server unit: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
- server integration (Docker): `cd server && pnpm exec vitest run test/eval.it.test.ts`
- server schema-drift check (AC-36): `cd server && pnpm db:generate && git status --porcelain server/src/db/migrations` must be empty — run once after T1, again after T7
- client: `cd client && pnpm test && pnpm typecheck`
- reviewer-core: untouched; `cd reviewer-core && npm test && npm run typecheck` as a regression check only, expected green with zero diff
- Any DB-backed server test **must** use the `.it.test.ts` suffix (root `README.md:167-169`, `TESTING.md`)
- Add a new test only where a task's Verification criterion above requires one

## AC Coverage

Verification location for every row below = the cited task's `Verification`
cell in **Phases** above.

| AC | Task(s) | AC | Task(s) | AC | Task(s) |
|---|---|---|---|---|---|
| AC-1 | T1, T5, T6, T7 | AC-17 | T3, T5, T6, T7 | AC-33 | T13 |
| AC-2 | T1, T5, T6, T7 | AC-18 | T3, T7 | AC-34 | T13, T14 |
| AC-3 | T5, T7 | AC-19 | T3, T5, T7 | AC-35 | T12 |
| AC-4 | T5, T6, T7 | AC-20 | T11 | AC-36 | T1, T7 |
| AC-5 | T1, T7 | AC-21 | T11 | AC-37 | T2, T7 |
| AC-6 | T6, T7 | AC-22 | T11 | AC-38 | T2, T5, T7 |
| AC-7 | T5, T6, T7 | AC-23 | T11 | AC-39 | T5, T7, T11, T12 |
| AC-8 | T2, T7 | AC-24 | T9, T11 | AC-40 | T2, T5 |
| AC-9 | T2, T7 | AC-25 | T9 | AC-41 | T14 |
| AC-10 | T5, T7 | AC-26 | T9 | AC-42 | T5, T6, T7, T11 |
| AC-11 | T2, T7 | AC-27 | T5, T6, T9, T10 | AC-43 | T12 |
| AC-12 | T2, T7 | AC-28 | T5, T7 | AC-44 | T2, T7 |
| AC-13 | T5, T6, T7 | AC-29 | T5, T6, T7, T10 | AC-45 | T11 |
| AC-14 | T4, T5, T7 | AC-30 | T5, T7, T9 | AC-46 | T3, T13 |
| AC-15 | T4, T5, T11 | AC-31 | T5, T6, T12 | AC-47 | T4, T5, T6, T7, T8 |
| AC-16 | T3, T5, T6, T7 | AC-32 | T13 | AC-48 | T2, T7 |

Every in-scope `AC-1`…`AC-48` appears exactly once above; several map to
multiple tasks where server logic, its route, and its integration test (or a
client hook and the UI consuming it) each independently exercise the same
criterion.

## Risks & Mitigations

- **Re-scoring drift if `actual_output` stored only raw findings.** Mitigated
  by Implementation Recommendations #1: persist `{produced, per_trace}` at run
  time; dashboard/tab reads never re-score against a possibly-since-edited
  `expected_output`, and never reconstruct `traces_passed` lossily from
  `recall * traces_total`.
- **`JobRunner` looked like a natural fit for AC-47 but names the wrong
  precedent.** Considered and rejected — see Implementation Recommendations
  #2. `JobRunner`/`jobs` is real and already used by `repos`/`repo-intel`, but
  AC-47 explicitly cites the `reviews`-module fire-and-forget pattern, and
  `JobRunner`'s whole-job retry would complicate AC-14's per-case isolation.
- **In-memory bulk-run tracker loses progress on server restart.** Acceptable
  for a local-first single-operator studio (matches this repo's existing
  `runBus` SSE state, which is equally in-memory); no `eval_runs` row is ever
  half-written since each row is inserted only on that case's own completion.
  T7 must not assert restart-survival.
- **`sliceDiff`'s whole-raw-diff fallback could silently produce an
  unrunnable or wrong-scope seed.** Confirmed by reading `reduce.ts:58-72`
  directly. Mitigated by Implementation Recommendations #4's mandatory
  slice-shape check before persisting a seed's `input_diff`, tested by T7.
- **Skill-owner version-label inference (AC-46) is approximate** when a
  skill's linked agent changed after some of its runs. Documented as a known
  limitation in T13; not treated as a bug, since the frozen schema has no
  column to pin a run to the agent it actually ran through.
- **Client `@devdigest/shared` is missing `AgentVersion`/`AgentVersionConfig`
  entirely.** Confirmed by diffing both vendor copies of `knowledge.ts`.
  Mitigated by T14 defining a local TypeScript interface instead of touching
  the do-not-touch vendor tree; T13 reuses that same local type rather than
  declaring a second one.
- **`GET /eval-dashboard/overview` returning `EvalDashboard[]` could be
  read as "one new contract."** It is not — `EvalDashboard` is unchanged and
  already the correct per-owner shape; only the route composes many of them.
  T6's verification greps for zero changes under `vendor/shared/`.
- **`eval/service.ts` duplicating a 15-line diff-load helper instead of
  importing `reviews/diff-loader.ts`.** Deliberate — `diff-loader.ts` is
  private to the `reviews` module (not exported via `container`), and onion
  layering forbids one feature module reaching into another's internals;
  duplicating ~15 lines is cheaper than promoting it to a shared facade for
  this plan's scope. Flagged here rather than silently diverging from DRY.
- **Bulk "Run all agents" cost.** AC-43's confirmation (T12) is the only
  guardrail — no server-side spend cap exists in this spec; out of scope to add
  one here.

## Out of Scope

Everything the spec's Non-goals section lists: compose-review, export-to-CI +
CI run ingestion, conformance checking, secret-leak/phantom hooks, the Plan
Verifier, and any change to `eval_cases`/`eval_runs` columns, `vendor/shared/**`,
`db/migrations/**`, or `reviewer-core/src/grounding.ts`. Also out of scope:
agent/skill **Stats** tabs (unrelated, adjacent in the mockup only), the
per-case `pass_threshold` override UI documented as a future extension by
AC-40, and architecture/security review, which are separate reviewer
passes from implementation.
