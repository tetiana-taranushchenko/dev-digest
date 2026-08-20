# INSIGHTS — mcp-server

Findings and insights for `mcp-server` (`@devdigest/mcp-server`).

## What Works

## What Doesn't Work

## Codebase Patterns

### 2026-08-20 — `devdigest_run_agent_on_pr` switched from `(repo, pr, agent)` to `(pr_id, agent_id)`
At the user's explicit request, `runAgentOnPrInputSchema` (`src/schemas.ts`) now takes `pr_id` (the PR's internal DevDigest id, e.g. a UUID) + `agent_id` instead of `repo`+`pr`+`agent`. This is a deliberate deviation from `docs/plans/mcp-server.md`'s REQ-5 ("flat, human-facing repo+pr args") — the plan file was left untouched as the historical spec; this entry is the record of the deviation. It also breaks REQ-14's stated parity with `devdigest_get_blast_radius`, which still takes `repo`+`pr` unchanged (out of scope, still a stub).

The handler no longer calls `resolveRepo`/`resolvePull` at all — it resolves `pr_id` directly via a new `resolvePullById` (`src/api/resolve.ts`) backed by a new `DevDigestApiClient.getPull(prId)` hitting `GET /pulls/:id` (`server/src/modules/pulls/routes.ts:35`, a single-PR-detail endpoint that already existed server-side but `mcp-server` had never called). This actually simplifies the handler: one fewer round trip (no `GET /repos`, no `GET /repos/:id/pulls`).

Consequence: `RunCache.CachedRun` (`src/runs/run-cache.ts`) no longer carries `repoId`/`repoFullName` — there's nothing to resolve them from anymore. `devdigest_get_findings`'s `run_id` path (Path A) therefore reports `repo: null` in its output; only the still-unchanged `repo`+`pr` path (Path B) can name the repo. `get-findings.ts` computes a `prLabel` (`"PR #N in repo"` or bare `"PR #N"`) once, used in every message that used to interpolate `repoFullName` unconditionally.

### 2026-08-20 — `devdigest_get_findings` redesigned to `(pr_id, all_runs?)`, grouped by agent — supersedes the entry above
Same session, same user request pattern (matching a reference tool's schema): `devdigest_get_findings` moved from `(run_id | repo+pr, response_format?, offset?, limit?)` to `(pr_id, all_runs?)` (`src/schemas.ts`, `src/tools/get-findings.ts`). It now fetches every run for `pr_id` (`GET /pulls/:id/runs`), groups by `agent_id`, and returns one entry per agent in a `reviews` array (`all_runs: true` returns every run per agent instead of just the newest) — each entry carries its own inline `status`/`error`/`findings` rather than the whole call being one `{status: ...}` shape. There is no `response_format` anymore — findings always project to the 11-key `DETAILED_FINDING_FIELDS` (id/review_id included) since there's no lighter mode to pick. `GET /pulls/:id/reviews` is fetched at most once, only if some selected run is `done`.

This makes the previous entry's `repo: null`/`prLabel` machinery, and `run_id`/Path A vs Path B split, entirely moot — deleted along with `checkFindingsIdentifier`/`FindingsIdentifierCheck`/`FINDINGS_CALL_SHAPES`/`runIdSchema` (`src/schemas.ts`). It also made `RunCache` (`src/runs/run-cache.ts`) fully dead code — `devdigest_run_agent_on_pr` only ever wrote to it (`remember()`), and nothing called `lookup()` once `get_findings` dropped `run_id` — so the whole module, its test, and its wiring through `RunAgentOnPrDeps`/`CreateMcpServerDeps`/`GetFindingsDeps`/`src/index.ts` were deleted. **Pattern worth remembering:** after any identifier-shape redesign, grep for read call sites (`.lookup(`, etc.) before assuming a cache/store built for the old shape is still needed — a write-only cache is dead weight, not a safety net.

### 2026-08-20 — `devdigest_get_conventions`'s `repo_id` corrected from a naming-only rename to a real internal id
Earlier the same day, `repo` was renamed to `repo_id` on `devdigest_get_conventions` but kept accepting "owner/name" (`repoSchema`) — the user later clarified she wanted a real internal id, matching `pr_id`'s pattern, not just a relabeled field. Added `repoIdSchema` (`src/schemas.ts`, mirrors `prIdSchema`) and a new `resolveRepoById(client, repoId)` (`src/api/resolve.ts`) that matches on `Repo.id` instead of `full_name` — reusing the existing `GET /repos` listing (`client.listRepos()`), since there is no dedicated `GET /repos/:id` endpoint server-side (unlike pulls' `GET /pulls/:id`). `get-conventions.ts` still surfaces the repo's `full_name` in its human-readable messages (e.g. "No conventions have been extracted yet for \"acme/payments-api\"") by reading it off the resolved `Repo` object — only the *input* changed to an id, the *messages* stayed readable. **Takeaway:** when a user says "just rename the field, the value/logic stays the same," confirm that's still true after any later request to correct it — a rename and a semantic identifier-type change look identical in a screenshot of an Inspector form field, but are very different amounts of work.

This also means the Open Questions entry below ("no tool exposes pr_id/repo_id for discovery") now applies to `get_conventions` again too — its `repo_id` has the same first-call discovery gap `pr_id` does.

## Tool & Library Notes

## Recurring Errors & Fixes

### 2026-08-20 — A tool's error/status message can hardcode ANOTHER tool's call shape, and TypeScript won't catch it going stale
`run-agent-on-pr.ts`'s `stillRunning()` message told the caller to retry `devdigest_get_findings` with `run_id="..."` — a plain string, not a typed reference — so when `get_findings`' schema dropped `run_id` in favor of `pr_id` (see the Codebase Patterns entry above), this message kept compiling and kept being wrong at runtime. Found and fixed 3 instances in this one redesign: `stillRunning()`'s own message (now takes `prId` as a parameter, not just `runId`), `run-agent-on-pr.ts`'s "no matching review was found" message, and `get-findings.ts`'s own "no runs yet" message (which named the OLD `run_agent_on_pr(repo=..., pr=..., agent=...)` shape from an earlier edit in the same session). **Takeaway:** after changing any tool's input schema, grep every OTHER tool's source for that tool's old param names inside string literals — the compiler gives zero signal here.

## Session Notes

## Open Questions

### 2026-08-20 — No tool exposes `pr_id` for an LLM caller to discover before the first `devdigest_run_agent_on_pr` call
`devdigest_get_findings`/`get_blast_radius`/`get_conventions` still work off `repo`+`pr` and never surface the internal `pr_id` in their own output (though `run_agent_on_pr`'s own completed result and `get_findings`' output now both echo `pr_id` back, so it's recoverable *after* a first successful call). For a human testing manually via MCP Inspector — this session's use case — copying `pr_id` from the DevDigest app's network tab (the `id` field in `GET /repos/:id/pulls`) works fine. A fully autonomous LLM caller with no prior context has no path to a valid `pr_id` at all. If that becomes a real requirement, consider a `devdigest_list_pulls(repo)` tool or surfacing `pr_id` from `get_findings`'/`get_blast_radius`'s repo+pr path.

**Update, same day:** `devdigest_get_findings` itself no longer uses `repo`+`pr` at all (see the later Codebase Patterns entry) — it's `pr_id`-only now, same as `run_agent_on_pr`. So this open question narrows to just `get_blast_radius`/`get_conventions` (both still `repo`-based, both unaffected). The underlying gap — no tool hands out a fresh `pr_id` from a `repo` alone — is otherwise unchanged.
