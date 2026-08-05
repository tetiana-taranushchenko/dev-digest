# INSIGHTS — server

Findings and insights for `server` (`@devdigest/api`). Empty for now — filled in as the course progresses.

## What Works

## What Doesn't Work

## Codebase Patterns

### 2026-08-04 — `agent_runs` rows for one "Run Review" click are created synchronously, before any LLM call
`server/src/modules/reviews/service.ts`'s `runReview` loops over every target agent and calls `createAgentRun` (status `'running'`) for ALL of them up front, then fires `executeRuns(...)` in the background (`void this.executor.executeRuns(...).catch(...)`, not awaited). So every `agent_runs` row belonging to one click lands within milliseconds/low seconds of each other in `ran_at` — useful as a cheap "same batch" grouping signal when there's no explicit batch id (see the Open Question below).

## Tool & Library Notes

### 2026-08-04 — Don't hand-write migrations; edit `schema/*.ts` and run `pnpm db:generate`
Root/`server/CLAUDE.md` flags `server/src/db/migrations/` as do-not-touch, but the actual workflow (per `server/package.json`'s `db:generate: "drizzle-kit generate"`) is: edit the Drizzle schema file (e.g. `server/src/db/schema/runs.ts`), then run `pnpm db:generate` to produce the migration SQL, then `pnpm db:migrate` to apply it. Added `costUsd: doublePrecision('cost_usd')` to `agentRuns` this way for the Run Cost Badge feature.

## Recurring Errors & Fixes

### 2026-08-04 — A field computed in `reviewer-core` can be silently dropped by destructuring in `run-executor.ts`
`reviewer-core/src/review/run.ts`'s `reviewPullRequest` already returned `costUsd` on `ReviewOutcome`, but `server/src/modules/reviews/run-executor.ts:213` did `const { tokensIn, tokensOut, grounding } = outcome;` — omitting `costUsd` meant it was computed on every run and then thrown away (never reached `completeAgentRun` or the run trace). When `reviewer-core`'s `ReviewOutcome`/`StructuredResult` gains a new field, grep `run-executor.ts` for where `outcome` is destructured — TypeScript won't warn about an unused property left off a destructure.

### 2026-08-05 — `pnpm db:migrate` fails with "column already exists" if the local Postgres volume predates a migration file
After pulling `server/src/db/migrations/0010_aberrant_scream.sql` (`ALTER TABLE "agent_runs" ADD COLUMN "cost_usd"...`), `./scripts/dev.sh` failed with `PostgresError: column "cost_usd" of relation "agent_runs" already exists`. Cause: the column already existed in the local `devdigest-postgres` Docker volume from before the migration file was committed, but Drizzle's `__drizzle_migrations` ledger had no record of applying it, so `drizzle-orm/postgres-js/migrator` tried to re-run the `ALTER TABLE` and Postgres rejected the duplicate column. Fix for local dev (disposable DB, no manual ledger editing needed): `docker compose down -v && ./scripts/dev.sh` — wipes the volume and lets `dev.sh` reapply all migrations plus `pnpm db:seed` cleanly.

## Session Notes

## Open Questions

### 2026-08-04 — Should PR-list COST use a real batch id instead of a `ran_at` time-window heuristic?
The Run Cost Badge feature needed "sum of cost for the latest review round," but there's no batch/group id linking the `agent_runs` rows created by one "Run Review" click — `multi_agent_runs` (`server/src/db/schema/runs.ts`) exists in the schema and migrations but is completely unwired to `runReview`/`agent_runs` (confirmed via grep — only referenced in schema/migration files). `server/src/modules/pulls/routes.ts` currently groups by a 60s `ran_at` proximity window from the newest run per PR as a stand-in. If L07 ("Multi-agent review") wires up `multi_agent_runs` for real, the cost-badge grouping in `pulls/routes.ts` should switch to querying it instead of the time-window heuristic.
