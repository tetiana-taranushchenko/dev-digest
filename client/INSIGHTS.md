# INSIGHTS — client

Findings and insights for `client` (`@devdigest/web`). Empty for now — filled in as the course progresses.

## What Works

## What Doesn't Work

## Codebase Patterns

### 2026-08-04 — Formatters used by >1 component tree belong in `client/src/lib/format.ts`, not co-located
`formatTokens`/`formatSeconds` live in `RunTraceDrawer/helpers.ts` because they were only ever used inside that one component tree. When the Run Cost Badge feature needed the same kind of formatting (`formatCost`, `formatTokenCount`) in three separate trees — `pulls/_components/PRRow`, `pulls/[number]/_components/RunHistory`, and `RunTraceDrawer/_components/TraceBody` — co-locating would've meant duplicating the function three times. Created `client/src/lib/format.ts` as the shared home instead; existing `RunTraceDrawer/helpers.ts` formatters were left in place (still single-consumer, no need to move them).

## Tool & Library Notes

## Recurring Errors & Fixes

### 2026-08-04 — A zod `.nullable()` field is REQUIRED (just null-valued); `.nullish()` is what makes it optional
Adding `cost_usd: z.number().nullable()` to `RunStats`/`RunSummary` (`client/src/vendor/shared/contracts/trace.ts`) meant every existing object literal typed against those contracts now needed the key present (even if `null`) — TypeScript failed on 3 fixtures missing it: `RunTraceDrawer.test.tsx`, `RunHistory.test.tsx`, and the mirrored `server/test/contracts.test.ts`. `PrMeta.cost_usd` was deliberately declared `.nullish()` instead (matching the existing `score` field), so mock GitHub clients typed as `PrMeta[]` (e.g. `server/src/adapters/mocks.ts`) didn't need updating. When adding a field to a shared contract, `.nullish()` is the lower-blast-radius choice unless every producer must consciously set it.

## Session Notes

## Open Questions
