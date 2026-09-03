# INSIGHTS — server

Findings and insights for `server` (`@devdigest/api`). Empty for now — filled in as the course progresses.

## What Works

## What Doesn't Work

### 2026-08-06 — `findings` table has no index on `review_id` or `dismissed_at`
`server/src/db/migrations/0000_init.sql` defines `findings` (line ~142) with only a FK constraint (`findings_review_id_reviews_id_fk`, line 378) and zero `CREATE INDEX` statements — confirmed by grepping the migration for `CREATE INDEX` and finding none scoped to `findings`. `pulls/routes.ts`'s findings query joins `reviews` on `findings.review_id` and filters `WHERE dismissed_at IS NULL`, so today this is a sequential scan on every PR-list load. Fine at current data volume; before findings grow into the hundreds of thousands, add a composite index on `(review_id, dismissed_at)` (covers both the join and the filter in one index).

## Codebase Patterns

### 2026-08-29 — Scan project context at run time, not only when it is attached
`modules/context/service.ts` reads attached document bodies fresh from the clone on every run (AC-12), so a warning computed by `PUT /agents/:id/context` can become stale after an out-of-band file edit. Put injection-risk detection in `modules/reviews/run-executor.ts` immediately after `readBodies`; keep it warning-only because legitimate security docs may quote attacks, and rely on reviewer-core's structural `<untrusted>` wrapping plus `INJECTION_GUARD` as the actual trust boundary.

### 2026-08-04 — `agent_runs` rows for one "Run Review" click are created synchronously, before any LLM call
`server/src/modules/reviews/service.ts`'s `runReview` loops over every target agent and calls `createAgentRun` (status `'running'`) for ALL of them up front, then fires `executeRuns(...)` in the background (`void this.executor.executeRuns(...).catch(...)`, not awaited). So every `agent_runs` row belonging to one click lands within milliseconds/low seconds of each other in `ran_at` — useful as a cheap "same batch" grouping signal when there's no explicit batch id (see the Open Question below).

### 2026-08-06 — Check `pulls/status.ts` before hand-rolling PR-list aggregation logic
`status.ts` already exported `rollupSeverities` (severity tally), with a docblock naming the FINDINGS breakdown as a `pulls`-list concern alongside SCORE/STATUS — but nothing imported it (`grep -rn rollupSeverities server/src` found only its own declaration) until this session wired it into `routes.ts:207`; the first draft hand-rolled the same tally inline instead of finding it. `rankFindingsForPreview` (severity+confidence sort, capped) was added next to it for the same reason. `pulls/status.ts` is the intended home for pure PR-list rollup helpers — check there first.

### 2026-08-06 — `pulls/routes.ts`'s findings query fetches ALL non-dismissed findings on purpose — it feeds two consumers, not one
`routes.ts:184-226` selects every non-dismissed finding (incl. `rationale`) per PR, then both `rollupSeverities(list)` (severity totals for `findings_by_severity`) and `rankFindingsForPreview(list, 5)` (top-5 for the hover preview) run over that *same* full list. An AI review flagged this as wasteful ("fetches everything just to keep 5"), proposing a window-function top-5-only query — that fix would silently break `findings_by_severity`, which needs the full non-dismissed set to count correctly, not just the top 5. If optimizing this later, only `rationale` (needed solely by the top-5 preview) is safe to defer into a second narrower query — the severity counts still need every row.

## Tool & Library Notes

### 2026-08-06 — `.select({ key: table })` in Drizzle selects every column of that table, not just named ones
`pulls/routes.ts`'s findings query and `reviews/repository/run.repo.ts:46`'s `listRunsForPull` both use `.select({ run: t.agentRuns, agentName: t.agents.name })` — `run` maps to the *entire* `agentRuns` row (all columns), unlike `activeRunsForPull` a few lines above (`run.repo.ts:16-21`) which picks individual named columns. This caused a false-positive AI code-review finding claiming `cost_usd` was missing from the result because the select clause "wasn't updated" — it didn't need to be; `run.costUsd` was already present via the whole-table select, confirmed by diffing commit `672fac9` (only the mapping line `cost_usd: run.costUsd,` was added, select clause unchanged). When reviewing/writing Drizzle selects, check whether the object value is a column (`t.x.col`) or a whole table (`t.x`) before assuming a field is unfetched.

### 2026-08-04 — Don't hand-write migrations; edit `schema/*.ts` and run `pnpm db:generate`
Root/`server/CLAUDE.md` flags `server/src/db/migrations/` as do-not-touch, but the actual workflow (per `server/package.json`'s `db:generate: "drizzle-kit generate"`) is: edit the Drizzle schema file (e.g. `server/src/db/schema/runs.ts`), then run `pnpm db:generate` to produce the migration SQL, then `pnpm db:migrate` to apply it. Added `costUsd: doublePrecision('cost_usd')` to `agentRuns` this way for the Run Cost Badge feature.

## Recurring Errors & Fixes

### 2026-08-04 — A field computed in `reviewer-core` can be silently dropped by destructuring in `run-executor.ts`
`reviewer-core/src/review/run.ts`'s `reviewPullRequest` already returned `costUsd` on `ReviewOutcome`, but `server/src/modules/reviews/run-executor.ts:213` did `const { tokensIn, tokensOut, grounding } = outcome;` — omitting `costUsd` meant it was computed on every run and then thrown away (never reached `completeAgentRun` or the run trace). When `reviewer-core`'s `ReviewOutcome`/`StructuredResult` gains a new field, grep `run-executor.ts` for where `outcome` is destructured — TypeScript won't warn about an unused property left off a destructure.

### 2026-08-05 — `pnpm db:migrate` fails with "column already exists" if the local Postgres volume predates a migration file
After pulling `server/src/db/migrations/0010_aberrant_scream.sql` (`ALTER TABLE "agent_runs" ADD COLUMN "cost_usd"...`), `./scripts/dev.sh` failed with `PostgresError: column "cost_usd" of relation "agent_runs" already exists`. Cause: the column already existed in the local `devdigest-postgres` Docker volume from before the migration file was committed, but Drizzle's `__drizzle_migrations` ledger had no record of applying it, so `drizzle-orm/postgres-js/migrator` tried to re-run the `ALTER TABLE` and Postgres rejected the duplicate column. Fix for local dev (disposable DB, no manual ledger editing needed): `docker compose down -v && ./scripts/dev.sh` — wipes the volume and lets `dev.sh` reapply all migrations plus `pnpm db:seed` cleanly.

### 2026-08-30 — pgvector query returns zero rows when embedding column dimension doesn't match model
Switched embedding model from OpenAI (1536 dims) to a smaller local model (768 dims), but `server/src/db/schema/embeddings.ts` still declared `embedding: vector(1536)`. Queries like `vec <=> embedding` silently returned zero results because pgvector rejects distance operations between vectors of mismatched dimensions (no error, just no matches). The fix: when changing embedding models, update the `vector(N)` column dimension in the Drizzle schema, run `pnpm db:generate` to create the migration, and `pnpm db:migrate` to apply it. Always verify the model's output dimension matches the schema declaration — grep the schema file for `vector(` to spot the mismatch. This applies to any pgvector columns, not just embeddings.

### 2026-08-05 — `pnpm db:migrate` fails with "column already exists" if the local Postgres volume predates a migration file

### 2026-08-19 — `ReviewRunResponse`'s doc comment claims `POST /pulls/:id/review` is synchronous; it isn't
`reviews/service.ts`'s `runReview` (`service.ts:103-138`) fires review execution as a detached, unawaited promise (`void this.executor.executeRuns(...)`, `service.ts:133`) and returns `{ runs, reviews: [] }` — `reviews` is a hard-coded empty array (`service.ts:137`). But the doc comment on `ReviewRunResponse` (`server/src/vendor/shared/contracts/review-api.ts:40-44`) says "the persisted reviews are also returned once the (synchronous) run completes" — that's stale and wrong (found while planning an external MCP client against this endpoint; the comment can't be fixed in place since it's in the do-not-touch vendored tree). A caller that needs the finished review must instead read `run_id` from the immediately-returned `runs[]` array, poll `GET /pulls/:id/runs` for that `run_id` until status leaves `'running'`, then fetch `GET /pulls/:id/reviews` and filter by `run_id` — race-free because `run-executor.ts` persists the review (`insertReview`, `run-executor.ts:315`) before flipping the run to `'done'` (`run-executor.ts:378`).

## Session Notes

### 2026-08-06 — `GET /repos/:id/pulls` now deliberately surfaces per-severity findings + a `top_findings` preview, reversing an earlier documented decision
`routes.ts` previously had a comment (removed this session, was ~line 114-117) stating findings were "intentionally not surfaced on the list." This session added `findings_by_severity` (counts) and `top_findings` (top `TOP_FINDINGS_LIMIT`, currently 5, `routes.ts:171`) to `PrMeta`, via a join that excludes dismissed findings and non-`'review'`-kind reviews — same IN-query-plus-JS-grouping style as the existing score/cost aggregation (no Drizzle `GROUP BY` precedent here). If list-endpoint payload size becomes a concern as PRs accumulate findings, `TOP_FINDINGS_LIMIT` is the knob to revisit first.

## Open Questions

### 2026-08-04 — Should PR-list COST use a real batch id instead of a `ran_at` time-window heuristic?
The Run Cost Badge feature needed "sum of cost for the latest review round," but there's no batch/group id linking the `agent_runs` rows created by one "Run Review" click — `multi_agent_runs` (`server/src/db/schema/runs.ts`) exists in the schema and migrations but is completely unwired to `runReview`/`agent_runs` (confirmed via grep — only referenced in schema/migration files). `server/src/modules/pulls/routes.ts` currently groups by a 60s `ran_at` proximity window from the newest run per PR as a stand-in. If L07 ("Multi-agent review") wires up `multi_agent_runs` for real, the cost-badge grouping in `pulls/routes.ts` should switch to querying it instead of the time-window heuristic.
