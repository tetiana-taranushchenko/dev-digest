# Development Plan: `devdigest-mcp` — local stdio MCP server (L04)

## Context

Course lesson **L04** in the root README's lesson table is "`devdigest-mcp`
server · Blast Radius (reads `repo-intel`)" (`README.md:85`). This plan covers
**only the MCP server**. It is a brand-new, standalone, local-only package at
`mcp-server/` that speaks MCP over **stdio** to Claude Desktop / Claude Code and
is a **pure HTTP client** of the already-running local API on
`http://localhost:3001`. It exposes 5 tools: `devdigest_list_agents`,
`devdigest_run_agent_on_pr`, `devdigest_get_findings`,
`devdigest_get_conventions`, and a deliberate `devdigest_get_blast_radius`
**stub** (the real Blast Radius is later homework).

**No changes to `server/`, `client/`, or `reviewer-core/`.** Every capability
below is reachable through existing HTTP endpoints, verified this session.

### Finding 1 — the review endpoint is NOT synchronous (changes the design)

The request assumed `POST /pulls/:id/review` blocks until the review is done and
returns populated `reviews`. **It does not.** `ReviewService.runReview`
(`server/src/modules/reviews/service.ts:103-138`) creates the `agent_runs` rows,
fires execution as a detached promise
(`void this.executor.executeRuns(...)`, `service.ts:133`) and returns
`{ runs, reviews: [] }` — a hard-coded **empty** `reviews` array
(`service.ts:137`). The doc comment on `ReviewRunResponse`
(`server/src/vendor/shared/contracts/review-api.ts:40-44`) says "the persisted
reviews are also returned once the (synchronous) run completes" — that comment
is **stale and wrong**; it lives in the do-not-touch vendored tree and this plan
does **not** correct it.

Consequences, all reflected in the tasks below:

1. `devdigest_run_agent_on_pr` **must poll**. "Blocking with a limit" is
   implemented as a client-side poll loop, not as one long HTTP call.
2. We do **not** need `GET /pulls/:id/runs/active` to discover the run id, as
   the request supposed — `POST /pulls/:id/review` already returns
   `runs: [{ run_id, agent_id, agent_name }]` synchronously
   (`reviews/routes.ts:43`). This is simpler and removes a race.
3. Polling on run status is **race-free**: `run-executor.ts` persists the review
   (`insertReview`, `run-executor.ts:315`) *before* flipping the run to `done`
   (`completeAgentRun({ status: 'done' })`, `run-executor.ts:378`). So
   `status === 'done'` guarantees the review row is readable.

### Finding 2 — the repo's zod pin is below the MCP SDK's floor

`@modelcontextprotocol/sdk@1.30.0` declares `peerDependencies.zod` as
**`^3.25 || ^4.0`**, and its README states the SDK "internally imports from
`zod/v4`" while remaining "backwards compatible with projects using **Zod v3.25
or later**". Every other package in this repo pins `zod@^3.24.1`
(`server/package.json`, `reviewer-core/package.json`), whose floor is **below
3.25**. `mcp-server/` must therefore pin `zod@^3.25` (or v4) in its **own**
lockfile — this is not a conflict, because the package is standalone and imports
shared contracts type-only (see *Affected Modules & Contracts*).

## Requirements

- **REQ-1 — Standalone package.** A new `mcp-server/` package with its own
  `package.json` + `package-lock.json` (npm, matching `reviewer-core/` and
  `e2e/`), `"type": "module"`, TypeScript, relative imports carrying the `.js`
  extension (root `CLAUDE.md` ESM convention). Not a workspace member. Nothing
  outside `mcp-server/` (plus the two follow-up doc/CI paths in Phase 5) is
  modified.
- **REQ-2 — stdio transport.** The server runs over `StdioServerTransport` from
  `@modelcontextprotocol/sdk` (pinned to **1.30.0**), launched as a local
  subprocess by Claude Desktop / Claude Code. No HTTP listener, no hosted mode.
- **REQ-3 — Pure HTTP client, configurable base URL.** All data comes from the
  local API via built-in `fetch` (Node ≥22, no axios/node-fetch). The base URL
  is `API_BASE_URL`, defaulting to `http://localhost:3001`.
- **REQ-4 — No shared-contract duplication.** `server/src/vendor/shared/` is not
  copied, vendored, or edited. Shared shapes are consumed as **type-only**
  imports through a tsconfig path alias (the `reviewer-core/tsconfig.json`
  precedent). See *Affected Modules & Contracts*.
- **REQ-5 — Exactly 5 tools, namespaced, flat primitive args.** Every tool name
  carries the **`devdigest_` prefix**, so the names stay unambiguous when the
  host has several MCP servers connected at once and the model can tell at a
  glance which server a tool belongs to:
  - `devdigest_list_agents()`
  - `devdigest_run_agent_on_pr(repo, pr, agent)`
  - `devdigest_get_findings(run_id | repo + pr, response_format?, offset?, limit?)`
  - `devdigest_get_conventions(repo)`
  - `devdigest_get_blast_radius(repo, pr)`

  The prefix applies to **tool names only** — no schema field is renamed, and
  `repo`/`pr` keep their names and their required/optional status everywhere.
  Every input is a flat string / number / string-enum — **no nested objects
  anywhere**, per the course slide's *"Плоскі аргументи"* principle (flat args
  are less error-prone for models, especially non-Anthropic ones). This holds
  for `devdigest_get_findings`'s extra parameters too: `response_format`,
  `offset` and `limit` are more flat primitives, not an options object.
- **REQ-6 — "Результат, а не операція".** `devdigest_run_agent_on_pr` performs
  resolve → trigger → wait → fetch findings in **one** call. The caller never
  sees the multi-step nature, never receives a run handle it must poll itself on
  the happy path.
- **REQ-7 — Blocking with a limit + fallback.** `devdigest_run_agent_on_pr`
  waits up to `REVIEW_TIMEOUT_MS` (default **120 000** ms). In every
  user-facing description string this budget is written the one same way —
  **"~2 min"** — and nowhere as "~90s". On timeout it **does not cancel** the
  server-side run and returns a structured "still running" result naming the
  concrete next action (`devdigest_get_findings` with that `run_id`).
- **REQ-8 — "Помилка веде далі".** Every failure path returns an actionable next
  step, never a dead end: unknown repo lists the known `full_name`s, unknown PR
  lists the known numbers, unknown agent lists valid `id` + `name` pairs, a
  cache miss in `devdigest_get_findings` names the cache-free alternative (call
  it again with `repo` + `pr`) as well as re-running
  `devdigest_run_agent_on_pr`, a PR that has **no runs at all** says to call
  `devdigest_run_agent_on_pr` first (never a bare empty result), an ambiguous
  or incomplete argument combination names both accepted call shapes, and a
  failed run surfaces the server's error text.
- **REQ-9 — "Стисла структурована відповідь".** Responses carry only fields the
  caller needs. Three exact finding projections exist — no others, and each is
  asserted key-for-key by a test:
  | Projection | Used by | Exact keys |
  |---|---|---|
  | **concise** | `devdigest_get_findings` with `response_format='concise'` (the default) | `severity`, `category`, `title`, `file`, `start_line`, `end_line`, `rationale` (7) |
  | **detailed** | `devdigest_get_findings` with `response_format='detailed'` | the 7 concise keys **plus** `suggestion`, `confidence`, `id`, `review_id` (11) |
  | **run result** | `devdigest_run_agent_on_pr` (unchanged from the original design) | `severity`, `category`, `title`, `file`, `start_line`, `end_line`, `rationale`, `suggestion`, `confidence` (9) — i.e. *detailed* minus the two identifiers |

  `id` and `review_id` are exposed **only** in *detailed* mode, deliberately: a
  caller that wants to act on one specific finding needs them for the existing
  `POST /findings/:id/accept` / `POST /findings/:id/dismiss` endpoints
  (`server/src/modules/reviews/routes.ts:143-147`). Everywhere else they are
  internal bookkeeping. In all three projections the remaining
  `FindingRecord`/`Finding` fields — `accepted_at`, `dismissed_at`, `kind`,
  `trifecta_components`, `evidence` (`contracts/review-api.ts:15-19`,
  `contracts/findings.ts:47-62`) — are dropped, and findings with a non-null
  `dismissed_at` are filtered out **before** any pagination slice, in both
  `response_format` modes.
- **REQ-10 — IDs resolved to names.** Responses echo human-readable identifiers
  next to opaque ones (`agent_name` beside `agent_id`, `repo` full_name and `pr`
  number beside internal UUIDs) to reduce model hallucination.
- **REQ-11 — Shared context written once.** The glossary ("what a repo / PR /
  agent / finding is in DevDigest") lives in **one** place — the server-level
  `instructions` option (`ServerOptions.instructions`, surfaced to the client in
  the `initialize` response) — and is not repeated across the 5 tool
  descriptions. Each tool description states its params and types, gives one
  example, and says when to use it vs not.
- **REQ-12 — Untrusted input.** All tool arguments are treated as untrusted LLM
  output: validated against strict Zod schemas, `repo` constrained by regex, and
  every interpolated path segment URL-encoded before it reaches a URL.
- **REQ-13 — stdout is reserved for JSON-RPC.** No `console.log` anywhere in
  `mcp-server/src/**`; diagnostics go to stderr. On the stdio transport stdout
  *is* the JSON-RPC wire, so a stray write makes the host fail with
  `SyntaxError: Unexpected token … is not valid JSON`.
- **REQ-14 — `devdigest_get_blast_radius` is a typed stub.** Its input schema is
  already the final one — `repo` and `pr`, both **required**, identical to
  `devdigest_run_agent_on_pr`'s pair, so the schema will not change when the
  real implementation lands. The handler returns a structured
  `{ status: "not_implemented", ... }` body with `isError: false` (**not** a
  thrown MCP error), makes **no HTTP call at all**, and its description says
  plainly that it is not implemented yet.
- **REQ-15 — Automated test coverage.** vitest unit tests (hermetic, injected
  fake fetch) plus `*.it.test.ts` integration tests that drive the real MCP
  server over `InMemoryTransport.createLinkedPair()` against a real loopback
  HTTP stub of the DevDigest API. Both lanes are separately runnable.
- **REQ-16 — Behaviour hints via `annotations`.** Every tool is registered with
  an `annotations` object — a field of `registerTool`'s `config` argument,
  **separate** from the natural-language `description` (`config.annotations?:
  ToolAnnotations`, SDK 1.30.0 `dist/esm/server/mcp.d.ts:150-157`). The schema
  has exactly five optional fields — `title`, `readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint` (`dist/esm/types.d.ts:2361-2367`); no others
  may be invented. Required values:
  | Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` | `openWorldHint` |
  |---|---|---|---|---|
  | `devdigest_list_agents` | `true` | `false` | — | — |
  | `devdigest_get_findings` | `true` | `false` | — | — |
  | `devdigest_get_conventions` | `true` | `false` | — | — |
  | `devdigest_run_agent_on_pr` | `false` | `false` | `false` | `true` |
  | `devdigest_get_blast_radius` | `true` | `false` | — | — |

  Rationale for the outlier: `devdigest_run_agent_on_pr` writes (a new
  `agent_runs` row per call) but destroys nothing; each call starts a **fresh**
  run, so it is not idempotent; and it triggers an LLM-backed review, which
  reaches outside the closed local dataset — hence `openWorldHint: true`.
  `devdigest_get_blast_radius` is trivially read-only because it is a stub that
  makes no calls at all (REQ-14).

## Affected Modules & Contracts

| Module | Change |
|---|---|
| `mcp-server/` | **New package** — everything in this plan. |
| `server/` | **None.** Read-only HTTP consumer of existing endpoints. |
| `client/` | **None.** |
| `reviewer-core/` | **None.** |
| `e2e/` | **None** (see T16). |

### Contract changes in `@devdigest/shared`: **none**

This was a deliberate decision, not an omission. Three options were considered:

1. **Vendor a third copy of `server/src/vendor/shared/`** — rejected. That tree
   is do-not-touch in root `CLAUDE.md` *and* `server/AGENTS.md:13`, and it is
   already manually mirrored into `client/src/vendor/shared/` with no auto-sync
   (`server/AGENTS.md:9`). A third un-synced copy triples the drift surface.
2. **Import the shared Zod schemas at runtime** — rejected. It would put a
   second `zod` module instance in play, and this repo has already been bitten
   by exactly that (`server/src/app.ts:147-154` hand-rolls shape-based
   `ZodError` detection because "`instanceof` can fail across duplicate zod
   module instances"; `reviewer-core/tsconfig.json` pins a `zod` path to its own
   `node_modules` for the same reason). It is also now a **version** conflict:
   the SDK needs zod ≥ 3.25, the shared tree is built against `^3.24.1`.
3. **Type-only imports through a tsconfig path alias — chosen.** Exactly the
   `reviewer-core/tsconfig.json` precedent
   (`"@devdigest/shared": ["../server/src/vendor/shared/index.ts"]`). Because
   every import is `import type`, it is fully erased at compile time: zero
   runtime dependency, no second zod instance at runtime, no lockfile
   entanglement, and the compiler still catches server-side contract drift.

Types consumed this way (all read-only): `Repo`, `PrMeta`, `Agent`,
`ReviewRecord`, `FindingRecord`, `Finding`, `RunSummary`, `ConventionCandidate`.

**Tool input** schemas are new MCP-specific contracts with no shared equivalent —
defined locally in `mcp-server/src/schemas.ts`. **Response** validation uses
narrow local zod schemas covering only the fields actually consumed, so an
unexpected server-side change degrades to a clear error instead of a crash.

> **Escape hatch (T1/T3):** these shared types are `z.infer<…>` aliases, so
> type-checking them still pulls zod *types* from two different zod versions,
> which the SDK's own FAQ names as a cause of `TS2589: Type instantiation is
> excessively deep and possibly infinite`. T1 pre-empts this by pinning
> `"zod": ["./node_modules/zod"]` in tsconfig `paths` (reviewer-core's
> precedent). If `TS2589` still appears, drop the `@devdigest/shared` alias and
> rely solely on the local narrow response schemas from T3 — they are required
> either way, so nothing else in the plan changes.

## Architecture Notes

### Verified API surface this package depends on

Every endpoint below was read this session; no others are used.

| Call | Source | Returns / notes |
|---|---|---|
| `GET /repos` | `repos/routes.ts:33` | `Repo[]`; `full_name` at `contracts/platform.ts:146` |
| `GET /repos/:id/pulls` | `pulls/routes.ts:27` | `PrMeta[]`; `number` at `platform.ts:160`, `id` is **nullish** (`platform.ts:159`) |
| `GET /agents` | `agents/routes.ts:74` | `Agent[]` incl. `skill_count` (`agents/service.ts:60-64`); DTO built by `toAgentDto` (`agents/helpers.ts:12-27`) |
| `POST /pulls/:id/review` | `reviews/routes.ts:27` | `{ pr_id, runs, reviews }` — **`reviews` is always `[]`** (`service.ts:137`) |
| `GET /pulls/:id/runs` | `reviews/routes.ts:101` | `RunSummary[]`, **already newest-first** (`orderBy(desc(t.agentRuns.ranAt))`, `reviews/repository/run.repo.ts:50`); `status` ∈ `running \| done \| failed \| cancelled` (`contracts/trace.ts:104`), plus `error` and `ran_at` (`trace.ts:113`) |
| `GET /pulls/:id/reviews` | `reviews/routes.ts:129` | All reviews for the PR, each carrying `run_id` (`reviews/helpers.ts:22,64`; `ReviewRecord.run_id` is nullable — `contracts/review-api.ts:27`) — filterable |
| `GET /repos/:id/conventions` | `conventions/routes.ts:21` | `ConventionCandidate[]` (`contracts/knowledge.ts:167-179`), already filtered to grounded rows (`conventions/service.ts:89-94`) |
| `GET /health` | `server/src/app.ts:112` | Rate-limit exempt; used for the startup connectivity check |

`POST /findings/:id/accept` and `POST /findings/:id/dismiss`
(`reviews/routes.ts:143-147`) are **not called** by this package — they are only
the reason `devdigest_get_findings`'s *detailed* projection exposes `id` and
`review_id` (REQ-9).

**No auth headers are needed.** `getContext` resolves tenancy through
`LocalNoAuthProvider`, which always returns the default workspace
(`modules/_shared/context.ts:9-23`).

**Error envelope** is uniform: `{ error: { code, message, details? } }`
(`server/src/app.ts:131-174`), with `422` for validation and the `AppError`
status otherwise. The API client maps this to a typed `ApiError` so tools can
surface the server's own message.

### Verified MCP SDK 1.30.0 facts (do not re-derive)

Line references below are to the published `1.30.0` npm tarball's `dist/esm/**`
type declarations, read this session.

- **Imports** (the `.js` suffix is mandatory; subpath `exports` require
  `moduleResolution` `Bundler` or `NodeNext`):
  - `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'`
  - `import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'`
  - `import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'`
- **Registration** is `server.registerTool(name, config, handler)`
  (`dist/esm/server/mcp.d.ts:150-157`). The older `server.tool(...)` overloads
  are marked `@deprecated Use 'registerTool' instead` in the SDK source
  (`mcp.d.ts:110-146`) — do not use them.
- **`inputSchema` is a raw object of Zod validators**, e.g.
  `inputSchema: { repo: z.string(), pr: z.number() }` — **not** a wrapping
  `z.object({...})`. This is the single easiest thing to get wrong. It also
  means there is **no `.refine()` seam** for a cross-field rule: any "exactly one
  of these arguments" constraint must be enforced inside the handler, after the
  SDK's per-field validation (this is what shapes `devdigest_get_findings`).
- **`annotations`** is its own field of `registerTool`'s `config` object
  (`annotations?: ToolAnnotations`, `mcp.d.ts:155`) — **separate from
  `description`**, which stays natural language. `ToolAnnotationsSchema` has
  exactly five optional fields: `title`, `readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint` (`dist/esm/types.d.ts:2361-2367`). The SDK's
  own note says all of them are **hints** only (`types.d.ts:2352-2360`).
- **`instructions`** is `ServerOptions.instructions?: string`, passed as
  `new McpServer({ name, version }, { instructions })`, and surfaced to the
  client in the `initialize` response as a model-facing hint.
- **Errors**: return `{ content: [...], isError: true }` rather than throwing.
- **Structured output** (`outputSchema` + `structuredContent`) exists and is
  permitted but **not required** — keeping a JSON-serialized `text` content
  block is sufficient for 5 small tools and avoids duplicate schema maintenance.
- **Testing**: `InMemoryTransport.createLinkedPair()` returns
  `[clientTransport, serverTransport]` and runs entirely in-process — no child
  process, no stdio.
- Node engine floor is `>=18`; this repo requires ≥22 (`README.md:93`), so Node
  22 is the target.

### Internal layering (dependency direction)

```
index.ts (transport/entry)
   → server.ts (registers tools)
      → tools/*.ts (validate → orchestrate → trim)
         → api/client.ts + api/resolve.ts + runs/run-cache.ts
```

Dependencies point one way only. `api/client.ts` knows nothing about MCP;
`tools/*.ts` never construct their own `fetch` or read `process.env` — deps are
injected, which is what makes the tools unit-testable without a network. This is
the `onion-architecture` skill's dependency-direction rule applied to a new
package; **`.claude/skills/onion-architecture/LAYER_MAP.md` is not edited** —
`mcp-server` is not a `server/` module and that map's rings do not cover it.

### Do-not-touch items in play

- `server/src/vendor/shared/` — read via type-only alias, never edited or
  copied. Includes the stale `ReviewRunResponse` comment
  (`contracts/review-api.ts:40-44`); leave it alone.
- `server/src/db/migrations/` — untouched (this package never reaches the DB).
- `reviewer-core/src/grounding.ts` — untouched. Findings arrive already
  grounded; the MCP server must never bypass or re-derive that gate.

### INSIGHTS.md entries that matter here

- `server/INSIGHTS.md:15` — "`agent_runs` rows for one 'Run Review' click are
  created synchronously, before any LLM call." Independent confirmation that the
  `run_id` is available immediately from the POST while the LLM work is still in
  flight. This is what makes the poll-by-`run_id` design work.
- `server/INSIGHTS.md:10` — `findings` has no index on `review_id` /
  `dismissed_at`, so `GET /pulls/:id/reviews` is a sequential scan. Argues for a
  poll interval of seconds, not milliseconds.

## Behaviour specifications

### `devdigest_run_agent_on_pr(repo, pr, agent)` — the only mutating tool

1. Validate flat args (REQ-12).
2. `GET /repos` → case-insensitive exact match on `full_name` → `repoId`.
   Miss → error listing available `full_name`s.
3. `GET /repos/:repoId/pulls` → match `number` → `prId`. Miss → error listing
   available numbers. `PrMeta.id` is nullish (`platform.ts:159`) — a match with
   a null `id` is treated as unresolvable with its own message.
4. `GET /agents` → accept `agent` as an id; if it is not a known id, fall back
   to a case-insensitive `name` match. Neither → error listing valid
   `id` + `name` pairs. A disabled agent is rejected with that fact stated.
5. `POST /pulls/:prId/review` body `{ agentId }` → take `runs[0].run_id`.
   Ignore the always-empty `reviews` field.
6. **Record `run_id → { repoId, prId, prNumber, repoFullName, agentId,
   agentName }` in the in-memory cache *before* polling**, so a timeout still
   leaves `devdigest_get_findings` usable.
7. Poll `GET /pulls/:prId/runs` every `POLL_INTERVAL_MS` (default 2 000) for the
   row whose `run_id` matches, until `status !== 'running'` or
   `REVIEW_TIMEOUT_MS` (default **120 000**, described to the model as **"~2
   min"**) elapses.
   - `done` → `GET /pulls/:prId/reviews`, filter `run_id === ours`, return
     `{ status: 'completed', verdict, summary, score, run_id, agent_id,
     agent_name, repo, pr, findings[] }` with findings in the **run-result**
     projection (REQ-9).
   - `failed` / `cancelled` → `{ status: 'failed' | 'cancelled', run_id, error,
     next_step }`, `isError: false`.
   - timeout → `{ status: 'still_running', run_id, message: "…still running…
     call devdigest_get_findings with run_id=\"…\"" }`, **no**
     `POST /runs/:id/cancel`.

A client-side abort genuinely cannot stop the server run: execution is a
detached promise (`service.ts:133`) and only `POST /runs/:id/cancel` sets the
status to `cancelled` (`service.ts:85-90`). Not cancelling on timeout is
therefore correct, not merely convenient.

### `devdigest_get_findings(run_id | repo + pr, response_format?, offset?, limit?)`

#### Two mutually exclusive ways to name the review

A caller identifies the review it wants **either** by `run_id` (the handle a
previous `devdigest_run_agent_on_pr` call in this same process returned) **or**
by `repo` + `pr` (which needs no cache at all). SDK 1.30.0's `inputSchema` is a
raw object of Zod validators rather than a wrapping `z.object()`
(`mcp.d.ts:150-157`), so there is **no `.refine()` seam** for a cross-field
rule. All three of `run_id`, `repo`, `pr` are therefore declared **optional** in
the schema, and the "exactly one of" rule is enforced **inside the handler**,
after the SDK's per-field validation, with `isError: true` and an actionable
message (REQ-8):

- neither `run_id` nor `repo` + `pr` given → message naming **both** accepted
  call shapes with one example each;
- both given → same message, stating explicitly that they are mutually exclusive
  and to pick one;
- `repo` without `pr` (or `pr` without `repo`) → message saying the pair must be
  supplied together, plus the `run_id` alternative.

#### Path A — `run_id` (unchanged)

No backend endpoint resolves a review by `run_id` alone —
`GET /pulls/:id/reviews` is PR-scoped and `GET /runs/:id/trace` returns a
`RunTrace` (prompt assembly, tool calls, stats — **not** verdict/findings). So
this path looks `run_id` up in the process-lifetime in-memory cache (T5) to
recover `prId`, then filters `GET /pulls/:prId/reviews` by `run_id`.

The cache is deliberately process-lifetime only (option (a) from the brief — no
backend change, matches the local-only scope). A miss must fail loudly and
actionably (REQ-8), never silently — and the miss message now leads with the
**cache-free** recovery: call the same tool again with `repo` + `pr`; re-running
`devdigest_run_agent_on_pr` is offered as the second option.

A cached `run_id` whose run is still `running`, `failed` or `cancelled` returns
the same shapes listed under Path B below.

#### Path B — `repo` + `pr` (new)

1. Resolve `repo` → `repoId` → `pr` → `prId` through **T4's shared resolver** —
   the same module `devdigest_run_agent_on_pr` and `devdigest_get_conventions`
   use, whose docstring already declares it shared. This is a second consumer,
   **not** a new resolver, and the misses produce T4's existing REQ-8 messages.
2. `GET /pulls/:prId/runs` → pick the **most recent run**. The endpoint already
   returns runs newest-first (`orderBy(desc(t.agentRuns.ranAt))`,
   `reviews/repository/run.repo.ts:50`) and `agent_runs.ran_at` is
   `defaultNow().notNull()` (`server/src/db/schema/runs.ts:15`), so the first
   row *is* the newest. The client still sorts defensively on
   `RunSummary.ran_at` (`contracts/trace.ts:113`, typed `string | null`),
   treating a null `ran_at` as oldest, so it does not depend on server ordering
   silently changing.
3. **Empty array — the PR has no runs at all** → an actionable message telling
   the caller to run a review first, naming
   `devdigest_run_agent_on_pr(repo, pr, agent)` and pointing at
   `devdigest_list_agents` for a valid `agent` (REQ-8). **Not** a bare empty
   result.
4. Most recent run `status === 'running'` → return the **same**
   `{ status: 'still_running', run_id, message }` object
   `devdigest_run_agent_on_pr` returns on timeout — one shape built by one
   shared helper, reused rather than reinvented.
5. Most recent run `failed` / `cancelled` → the same error shape as Path A:
   `{ status: 'failed' | 'cancelled', run_id, error, next_step }` with
   `isError: false`, surfacing `RunSummary.error`.
6. Most recent run `done` → `GET /pulls/:prId/reviews` and take the review whose
   `run_id` equals that run's `run_id` (`ReviewRecord.run_id`, nullable —
   `contracts/review-api.ts:27`). Race-free by Context Finding 1(3). A `done`
   run with no matching review row gets its own distinct actionable message
   rather than an empty list.

#### Projection and pagination (both paths)

Both paths converge on exactly **one** resolved review, and everything below
operates on that single review's `findings` array
(`ReviewRecord.findings: FindingRecord[]`, `contracts/review-api.ts:36`) —
pagination never spans multiple reviews or runs.

1. Drop every finding with a non-null `dismissed_at` (REQ-9) — **before**
   slicing, so `offset`/`limit` address the same list the caller sees.
2. Slice `[offset, offset + limit)`. Defaults `offset = 0`, `limit = 25`
   (hard maximum 100), chosen so an unpaginated call stays well inside the
   ~25 000-token response budget that the "стисла відповідь" framing of REQ-9
   targets — a 200-finding review must not be dumped into the model's context by
   accident.
3. Project each remaining finding through the **concise** (default) or
   **detailed** field list of REQ-9 — exactly those keys, nothing else.
4. Return `{ status: 'completed', verdict, summary, score, run_id, agent_id,
   agent_name, repo, pr, response_format, total, returned, offset, limit,
   has_more, findings[] }`, where `total` counts the non-dismissed findings of
   that review and `has_more` tells the caller another page exists; when
   `has_more` is true the response also carries a `next_step` naming the exact
   follow-up call with the next `offset` (REQ-8).

### `devdigest_get_conventions(repo)` / `devdigest_get_blast_radius(repo, pr)`

`devdigest_get_conventions` resolves `repo` through T4's shared resolver and
returns the grounded convention rows trimmed to REQ-9's sibling projection for
conventions (see T10).

`devdigest_get_blast_radius` takes `repo` **and** `pr`, both **required** —
identical to `devdigest_run_agent_on_pr`'s pair, which is deliberately the shape
the real tool will keep — makes **no HTTP call whatsoever**, and returns
`{ status: 'not_implemented', message, repo, pr }` with `isError: false`
(REQ-14). The `devdigest_` rename changes its name only; its schema field names,
their required status, and its zero-HTTP behaviour are untouched.

## Tool Descriptions (final text)

The strings below are the exact `description` values `T6`'s
`shared-context.ts` exports (one named constant per tool, plus the single
`SERVER_INSTRUCTIONS` glossary — REQ-11). `T7`–`T10` copy these **verbatim**
into their `registerTool` calls; they are reference text, not paraphrased
during implementation. Each already satisfies REQ-8 (actionable next step),
REQ-9 (no unqualified "findings" — the field lists are named), and REQ-11
(no repeated glossary, one example, a "use this when" clause).

### `SERVER_INSTRUCTIONS` (server-level, written once)
```
DevDigest is a local-first AI PR review tool. A repo is identified as
"owner/name" (its GitHub full name). A PR is identified by its GitHub
number within that repo. An agent is a configured reviewer (a model +
system prompt); look one up with devdigest_list_agents. A run is one
execution of one agent against one PR, identified by a run_id. A finding
is one issue an agent found, with a severity (CRITICAL/WARNING/SUGGESTION),
a file, and a line range.
```

### `devdigest_list_agents`
```
List the reviewer agents configured in this DevDigest workspace (id, name,
model, enabled). Call this first to get a valid agent id for
devdigest_run_agent_on_pr — do not guess or invent agent ids. Takes no
arguments.
```

### `devdigest_run_agent_on_pr`
```
Run one reviewer agent on a pull request and return the result — this
single call triggers the review, waits for it to finish (up to ~2 min),
and returns the verdict and findings; you do not need to poll. Args: repo
(owner/name, e.g. "acme/payments-api"), pr (the GitHub PR number, e.g.
482, not an internal id), agent (an id from devdigest_list_agents — do not
guess it). If the review is still running after ~2 min, the result is
{status:'still_running', run_id}; call devdigest_get_findings with that
run_id (or with repo+pr) later.
```

### `devdigest_get_findings`
```
Get the verdict and findings of an already-started review run. Identify it
either by run_id (returned by devdigest_run_agent_on_pr — prefer this when
you have it) or by repo+pr (looks up the most recent run for that PR).
Defaults to a concise summary (severity, category, title, file, start_line,
end_line, rationale); pass response_format:'detailed' for the full set
(adds suggestion, confidence, id, review_id — needed to call the
accept/dismiss endpoints on one finding). Use offset/limit to page through
large result sets (default limit 25). If run_id is unknown, or repo+pr
never had a review run, the result names the fix.
```

### `devdigest_get_conventions`
```
Get this repository's extracted coding conventions (category, rule,
evidence_ref, confidence, accepted). Args: repo (owner/name). Use this to
check or justify a finding against the repo's house rules; if none have
been extracted yet, the result points at the Conventions page.
```

### `devdigest_get_blast_radius`
```
⚠️ STUB — not yet implemented. Will eventually map which files/symbols a
PR's changes affect elsewhere in the repo (reads repo-intel). Args: repo,
pr — same required shape as devdigest_run_agent_on_pr, so the contract
won't change later. Always returns {status:'not_implemented', ...} with no
real data — do not rely on its output.
```

## Phases

### Phase 1: Package skeleton & contracts

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T1 | mcp-server | setup | `mcp-server/package.json`, `mcp-server/package-lock.json`, `mcp-server/tsconfig.json`, `mcp-server/vitest.config.ts`, `mcp-server/.env.example` | — | typescript-expert | `cd mcp-server && npm install && npm run typecheck` passes on an empty `src/`, and `npm ls zod` reports **exactly one** zod version, `>=3.25` (the SDK's peer floor — the repo-wide `^3.24.1` pin is **too low**, see Context Finding 2). `package.json`: `"type":"module"`, name `@devdigest/mcp-server`, private, exact pin `"@modelcontextprotocol/sdk": "1.30.0"`, scripts `dev`/`build`/`start`/`typecheck`/`test`/`test:unit`/`test:it`, and **no** axios/node-fetch (assert via `node -e "console.log(Object.keys(require('./package.json').dependencies))"`). `tsconfig.json` mirrors `reviewer-core/tsconfig.json` (`ES2022`, `strict`, `noUncheckedIndexedAccess`, `moduleResolution: "Bundler"` — required for the SDK's subpath exports) but emits (`outDir: dist`, `noEmit` false), and its `paths` contain both `"@devdigest/shared": ["../server/src/vendor/shared/index.ts"]` **and** `"zod": ["./node_modules/zod"]` (the reviewer-core precedent that pre-empts `TS2589`). `git check-ignore mcp-server/node_modules mcp-server/dist` matches both — root `.gitignore` already covers them, so do **not** add a new `.gitignore`. |
| T2 | mcp-server | setup | `mcp-server/src/config.ts`, `mcp-server/test/config.test.ts` | T1 | typescript-expert, zod, security | `loadConfig(env)` is a **pure function of an injected env object** (never reads `process.env` internally) returning `{ apiBaseUrl, reviewTimeoutMs, pollIntervalMs, resolveTimeoutMs }`. Defaults: `http://localhost:3001`, **`120000`**, `2000`, `20000`. Test proves: defaults apply on empty env and `reviewTimeoutMs` is asserted to equal exactly `120000` (REQ-7); `API_BASE_URL` overrides; a trailing slash is normalised away; a non-numeric or negative `REVIEW_TIMEOUT_MS` is rejected with a message naming the variable; `pollIntervalMs` below 1000 is rejected (the API's global rate limit is 120/min — `server/README.md:54`). `npm run test:unit && npm run typecheck` green. |

### Phase 2: API client, resolution, run cache

T4 and T5 own disjoint files and neither depends on the other, so they are safe
to run in parallel implementer instances once T3 lands.

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T3 | mcp-server | api | `mcp-server/src/api/client.ts`, `mcp-server/src/api/types.ts`, `mcp-server/test/api-client.test.ts` | T2 | typescript-expert, zod, security, onion-architecture *(dependency direction only — do not edit LAYER_MAP.md)* | `DevDigestApiClient` takes `{ baseUrl, fetch }` **injected** (no module-level `fetch` capture, no `process.env`). It exposes `listRepos`, `listPulls`, `listAgents`, `startReview`, `listRuns`, `listReviews`, `listConventions`, `health`. Every path segment is `encodeURIComponent`-wrapped. Non-2xx responses parse into a typed `ApiError` carrying `status` + the envelope's `error.code`/`error.message` (`server/src/app.ts:131-174`); a non-JSON body degrades to the status text instead of throwing. Each request honours a per-call `AbortSignal` timeout. `types.ts` holds the narrow local zod response schemas (only consumed fields) plus any type-only `@devdigest/shared` imports. Tests (injected fake fetch, no network) cover: happy path; a 404 envelope surfacing `error.message`; a non-JSON 500; an abort producing a timeout error naming the endpoint. `grep -rn "from '@devdigest/shared'" mcp-server/src` prints **only** `import type` lines. `npm run test:unit && npm run typecheck` green. |
| T4 | mcp-server | api | `mcp-server/src/api/resolve.ts`, `mcp-server/test/resolve.test.ts` | T3 | typescript-expert, security | One shared module used by `devdigest_run_agent_on_pr`, `devdigest_get_findings` (its `repo` + `pr` path), `devdigest_get_conventions` and (schema-only) `devdigest_get_blast_radius` — the `GET /repos` lookup is **not** duplicated per tool, and the module docstring names all four consumers. `resolveRepo(client, "owner/name")` matches `full_name` case-insensitively; `resolvePull(client, repoId, number)` matches `PrMeta.number`; `resolveAgent(client, idOrName)` matches id then case-insensitive name. Tests prove each miss throws an error whose message **enumerates the available options** (full_names / numbers / `id` + `name` pairs) per REQ-8, that a matched PR with a `null` `id` yields its own distinct actionable message (`platform.ts:159`), and that a disabled agent is rejected with that stated reason. `npm run test:unit && npm run typecheck` green. |
| T5 | mcp-server | state | `mcp-server/src/runs/run-cache.ts`, `mcp-server/test/run-cache.test.ts` | T2 | typescript-expert | In-memory `Map` of `run_id → { repoId, prId, prNumber, repoFullName, agentId, agentName }` with `remember()` / `lookup()`, bounded to a documented max entry count with FIFO eviction so a long-lived process cannot grow without limit. The module's docblock states plainly that it is **process-lifetime only**, and that the `repo` + `pr` path of `devdigest_get_findings` exists precisely so a miss is recoverable. Tests prove: round-trip; a miss returns `undefined` (never throws — the caller owns the message); eviction drops the oldest past the cap. `npm run test:unit && npm run typecheck` green. |

### Phase 3: The 5 tools

Every task owns exactly one tool file (T10 owns two small ones) plus its own test
files, and each exports a `register<Tool>(server, deps)` function. **None of them
edits `src/server.ts`** (T11 owns it), so T7, T8 and T10 are safe to run in
parallel. T9 runs after **both** T4 and T8: it imports T8's trimming +
`still_running` helpers *and* T4's shared resolver for its `repo` + `pr` path.
Since T4 completes in Phase 2 and T8 in Phase 3, the T9-after-T8 edge is the
binding one and the parallel-safe sets below are unchanged.

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T6 | mcp-server | tools | `mcp-server/src/schemas.ts`, `mcp-server/src/tools/shared-context.ts`, `mcp-server/test/schemas.test.ts` | T2 | zod, security, typescript-expert | `schemas.ts` exports the flat inputs **as raw objects of Zod validators, not `z.object(...)` wrappers** — that is the shape SDK 1.30.0's `registerTool` expects (`mcp.d.ts:150-157`). Field validators, reused across tools: `repo` (`z.string()` matching `/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/`, max 200), `pr` (`z.number().int().positive()`), `agent` (non-empty string, max 200), `run_id` (non-empty string, max 200). `devdigest_get_blast_radius` keeps `repo` + `pr` **required** (a test asserts neither is optional). `devdigest_get_findings`'s input is `{ run_id?, repo?, pr?, response_format, offset, limit }` — all three identifiers **optional** (the cross-field rule cannot live in the schema, see the Behaviour spec), `response_format: z.enum(['concise','detailed']).default('concise')`, `offset: z.number().int().min(0).default(0)`, `limit: z.number().int().min(1).max(100).default(25)`; `repo`/`pr` reuse the exact same validators as the other tools (a test asserts identity of the validator instances or of their parse behaviour on the same fixtures). **No schema value is a nested object** — asserted by a test walking each exported schema and unwrapping `ZodOptional`/`ZodDefault` before checking the inner type is a primitive/enum (REQ-5). Tests prove rejection of `../`, `owner/name/extra`, absolute URLs, an empty string, `pr: 0`, `pr: -1`, `offset: -1`, `limit: 0`, `limit: 101`, and `response_format: 'verbose'`. A further test exercises the exported **cross-field guard** used by T9's handler and asserts an actionable message (naming both accepted call shapes) for each of: both `run_id` and `repo`/`pr` given; neither given; `repo` without `pr`; `pr` without `repo` (REQ-8). `shared-context.ts` exports one `SERVER_INSTRUCTIONS` string — the sole glossary of repo/PR/agent/finding — plus the per-tool description constants (all 5 names carrying the `devdigest_` prefix, and every timeout mention written as **"~2 min"**, asserted by a test grepping the constants for the string "90"). **The exact text of `SERVER_INSTRUCTIONS` and all 5 description constants is given verbatim in the "## Tool Descriptions (final text)" section above this plan's Phases — copy it, do not rewrite it.** A test asserts the glossary sentence appears in `SERVER_INSTRUCTIONS` and in **none** of the 5 tool descriptions, and that each description contains both an example and a "use this when / not when" clause (REQ-11). `npm run test:unit && npm run typecheck` green. |
| T7 | mcp-server | tools | `mcp-server/src/tools/list-agents.ts`, `mcp-server/test/list-agents.test.ts` | T3, T6 | typescript-expert, zod | Registers **`devdigest_list_agents`** wrapping `GET /agents`. Returns a compact list trimmed to exactly `{ id, name, description, enabled, model }` — `model` is a real field of the DTO (`toAgentDto` returns `model: row.model`, `agents/helpers.ts:18`; `Agent.model` at `contracts/knowledge.ts:209`) and is included because it is what a caller actually needs to pick an agent. Verified against `AgentsService.list` (`agents/service.ts:60-64`); `system_prompt`, `output_schema`, `provider`, `version`, `strategy`, `ci_fail_on`, `repo_intel`, `skill_count` are dropped. Test asserts the **exact** key set `['id','name','description','enabled','model']` of a returned item (no more, no fewer) and that an empty agent list yields an actionable message rather than a bare `[]`. A further test asserts the tool is registered with `annotations` exactly `{ readOnlyHint: true, destructiveHint: false }` (REQ-16). `npm run test:unit && npm run typecheck` green. |
| T8 | mcp-server | tools | `mcp-server/src/tools/run-agent-on-pr.ts`, `mcp-server/test/run-agent-on-pr.test.ts` | T3, T4, T5, T6 | typescript-expert, zod, security | Registers **`devdigest_run_agent_on_pr`** and implements the 7-step sequence in *Behaviour specifications* exactly. It exports the helpers T9 reuses: the finding-trimming function together with the three REQ-9 field-list constants (concise / detailed / run-result), and the `stillRunning(run_id)` result builder. Unit tests with an injected fake fetch + **fake clock** prove all four outcomes: (a) **happy path** — one call performs resolve → POST → poll → fetch, and the result carries `verdict`, run-result-projected `findings`, `run_id`, `agent_name`, `repo`, `pr`; the caller invokes the tool exactly **once** (REQ-6); (b) **timeout** — when the run stays `running` past `reviewTimeoutMs` (asserted against the `120000` default from T2), the result is `status: "still_running"` with `isError: false`, the message names `devdigest_get_findings` **and** the literal `run_id`, `POST /runs/:id/cancel` was **never** requested (assert against the fake fetch's call log), and the run was written to the cache **before** polling began; (c) **failed run** — `status: 'failed'` surfaces the server's `RunSummary.error` text plus a next step; (d) **trimming** — a fixture finding carrying `id`, `review_id`, `accepted_at`, `dismissed_at`, `kind`, `evidence` is reduced to exactly the 9 run-result keys of REQ-9, and a finding with a non-null `dismissed_at` is excluded. A further test asserts the poll loop issues no request more often than `pollIntervalMs`, and one asserts `annotations` is exactly `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }` (REQ-16). `npm run test:unit && npm run typecheck` green. |
| T9 | mcp-server | tools | `mcp-server/src/tools/get-findings.ts`, `mcp-server/test/get-findings.test.ts` | T3, T4, T5, T6, T8 | typescript-expert, zod | Registers **`devdigest_get_findings`** with the dual-identifier input of T6, **importing** T8's trimming helper + field-list constants and T8's `stillRunning` builder, and T4's resolver, rather than re-implementing any of them (tests assert the shared resolver and the shared helper are the ones invoked). Tests prove: **(a) argument guard** — all four bad combinations (both identifiers, neither, `repo` alone, `pr` alone) return `isError: true` with a message naming both accepted call shapes; **(b) `run_id` path, unchanged** — a cache hit returns the verdict + trimmed findings; a cache **miss** returns a clear actionable error whose text names both the cause ("not found in this session") and the two fixes, leading with "call again with `repo` and `pr`" and then re-running `devdigest_run_agent_on_pr` — and is **not** a silent empty result (REQ-8); a cached `run_id` still `running` returns `status: 'still_running'`; a cached `run_id` that `failed` surfaces the error; **(c) `repo` + `pr` path, happy** — resolver → `GET /pulls/:prId/runs` → the run with the newest `ran_at` is selected (fixture deliberately returns rows out of order to prove the client's own defensive sort, `contracts/trace.ts:113`) → `GET /pulls/:prId/reviews` → the review whose `run_id` matches that run is returned; **(d) `repo` + `pr`, most recent run `running`** → the **same object shape** as T8's timeout result (asserted key-for-key against T8's builder), not a new shape; **(e) `repo` + `pr`, most recent run `failed`/`cancelled`** → same `{ status, run_id, error, next_step }` shape as the `run_id` path; **(f) `repo` + `pr`, PR has no runs at all** → an actionable message naming `devdigest_run_agent_on_pr` as the next call (REQ-8), asserted **not** to be an empty findings array; **(g) `response_format`** — the default/`'concise'` result's finding keys equal exactly `['severity','category','title','file','start_line','end_line','rationale']` and `'detailed'` equals exactly those plus `['suggestion','confidence','id','review_id']` (REQ-9), asserted as exact sets in both directions; **(h) pagination** — `offset`/`limit` slice the **one** resolved review's findings (`offset: 2, limit: 2` on a 6-finding fixture returns findings 3–4 and `has_more: true`, `total: 6`), and a call with **no** `offset`/`limit` returns at most the default 25 with `has_more: true` on a 40-finding fixture; **(i) dismissed filtering** — a finding with a non-null `dismissed_at` is absent in **both** `response_format` modes and is excluded from `total`, i.e. filtered before slicing. `npm run test:unit && npm run typecheck` green. |
| T10 | mcp-server | tools | `mcp-server/src/tools/get-conventions.ts`, `mcp-server/src/tools/get-blast-radius.ts`, `mcp-server/test/get-conventions.test.ts`, `mcp-server/test/get-blast-radius.test.ts` | T3, T4, T6 | typescript-expert, zod, security | **`devdigest_get_conventions`**: resolves `repo` via T4's shared helper (a test asserts the shared resolver is called, so the `GET /repos` lookup is not duplicated), then `GET /repos/:id/conventions`, trimmed to **exactly** `{ category, rule, evidence_ref, confidence, accepted }` — every one a real field of `ConventionCandidate` (`server/src/vendor/shared/contracts/knowledge.ts:167-179`: `evidence_ref` at :174, `confidence` at :175, `accepted` — a real boolean, "true exactly when status is `approved`" — at :177-178). There is **no `file` field** and `status` is deliberately **not** returned (`accepted` is the boolean projection of it); `id`, `evidence_path`, `evidence_line`, `evidence_snippet`, `status` are dropped. A test asserts the exact key set. An empty list returns an actionable message pointing at the extractor rather than `[]`. **`devdigest_get_blast_radius`**: its input schema is the final `repo` + `pr` pair, **both required**, identical to `devdigest_run_agent_on_pr`'s (asserted by a test comparing them, including that neither is optional); the handler **makes no HTTP call at all**, and it returns `isError: false` with `{ status: "not_implemented", message, repo, pr }`. Tests assert `isError === false` (it must **not** throw an MCP error), that the description contains a plain not-implemented statement, and that no fetch was issued. A `TODO` comment names `server/src/modules/repo-intel/` as the future source and records that **no HTTP endpoint exposes blast radius today** — `repo-intel/routes.ts` serves only `/repos/:id/index-state` and `/repos/:id/resync`, so the real tool will need a new server endpoint (out of scope here). One test per tool asserts `annotations` is exactly `{ readOnlyHint: true, destructiveHint: false }` for **both** (REQ-16). `npm run test:unit && npm run typecheck` green. |

### Phase 4: Server assembly, entry point, integration tests

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T11 | mcp-server | server | `mcp-server/src/server.ts`, `mcp-server/test/server.test.ts` | T7, T8, T9, T10 | typescript-expert, onion-architecture *(dependency direction only)* | `createMcpServer(deps)` builds `new McpServer({ name: 'devdigest', version }, { instructions: SERVER_INSTRUCTIONS })` and calls all five `register*` functions, each using `server.registerTool(name, config, handler)` (**never** the deprecated `server.tool(...)`). It is **transport-free** — it never imports `StdioServerTransport` — so it is testable in-process; a test asserts that. A test lists the registered tools and asserts **exactly** these 5 names, in a set comparison that fails on any extra or missing entry: `devdigest_list_agents`, `devdigest_run_agent_on_pr`, `devdigest_get_findings`, `devdigest_get_conventions`, `devdigest_get_blast_radius`; that every one has a non-empty description; that the server's advertised instructions equal `SERVER_INSTRUCTIONS`; and that **each tool's `annotations` object deep-equals the REQ-16 table** — `readOnlyHint: true, destructiveHint: false` for `devdigest_list_agents`, `devdigest_get_findings`, `devdigest_get_conventions` and `devdigest_get_blast_radius`, and `readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true` for `devdigest_run_agent_on_pr` (assert on the `tools/list` result, so it covers what the client actually sees). `npm run test:unit && npm run typecheck` green. |
| T12 | mcp-server | server | `mcp-server/src/index.ts`, `mcp-server/test/no-stdout.test.ts` | T11 | typescript-expert, security | Entry point: reads `process.env` **here and only here** (the one composition-root read, feeding T2's pure `loadConfig`), builds the client + server, connects `StdioServerTransport`, and handles `SIGINT`/`SIGTERM` with a clean shutdown. All diagnostics go to **stderr**. `test/no-stdout.test.ts` asserts `grep -rn "console\.log" mcp-server/src` finds **nothing** (REQ-13) and that `src/` contains no `process.stdout.write`. `npm run build && node dist/index.js` starts, stays alive, writes nothing to stdout before the first JSON-RPC message, and exits 0 on SIGTERM. `npm run test:unit && npm run typecheck` green. |
| T13 | mcp-server | test | `mcp-server/test/tools.it.test.ts` | T11, T12 | typescript-expert | Integration lane, mirroring `server/`'s naming convention: files matching `*.it.test.ts` are the non-hermetic lane and `test:unit` must exclude them. Boots a **real `node:http` stub of the DevDigest API on an ephemeral port** (no testcontainers, no Docker, no running studio required), points `API_BASE_URL` at it, and connects a real MCP `Client` to `createMcpServer` via `InMemoryTransport.createLinkedPair()` (`@modelcontextprotocol/sdk/inMemory.js`). Every `callTool` uses the **namespaced** names and the test asserts the client-visible `tools/list` contains exactly those 5 names: `devdigest_list_agents` returns the trimmed list (incl. `model`); `devdigest_run_agent_on_pr` walks the real resolve → POST → poll → reviews sequence against the stub (which reports `running` twice, then `done`) and returns grounded findings; `devdigest_get_findings` with that same `run_id` returns the same verdict; `devdigest_get_findings` with **`repo` + `pr`** (no `run_id`) returns the same review via the most-recent-run path; `devdigest_get_findings` with `response_format: 'detailed'` returns the 11-key findings and with `offset`/`limit` returns the sliced page; `devdigest_get_findings` with an unknown `run_id` returns the actionable cache-miss message naming the `repo` + `pr` alternative; `devdigest_get_findings` for a PR the stub reports as having **no runs** returns the "run a review first" message; `devdigest_get_blast_radius` returns `not_implemented` with `isError: false`. `cd mcp-server && npm run test:it` green, and `npm run test:unit` does **not** execute this file (assert by comparing reported test-file counts). |

### Phase 5: Follow-ups (not for `implementer`)

| Task ID | Module | Type | Owned paths | Depends-on | Skills to use | Acceptance |
|---|---|---|---|---|---|---|
| T14 | docs | docs | `mcp-server/README.md`, `mcp-server/AGENTS.md`, `mcp-server/INSIGHTS.md`, root `README.md` (package table + L04 row) | T13 | mermaid-diagram *(via `doc-writer`)* | `README.md` follows `reviewer-core/README.md`'s shape: one-paragraph purpose, a Mermaid diagram of `MCP client → stdio → mcp-server → HTTP → :3001`, the 5-tool table, env-var table, and the **exact** `mcpServers` JSON block — `{"mcpServers":{"devdigest":{"command":"node","args":["<abs>/mcp-server/dist/index.js"],"env":{"API_BASE_URL":"http://localhost:3001"}}}}` — plus the `claude mcp add --transport stdio devdigest -- node <abs>/dist/index.js` CLI equivalent. The tool table lists the **namespaced** names (`devdigest_list_agents`, `devdigest_run_agent_on_pr`, `devdigest_get_findings`, `devdigest_get_conventions`, `devdigest_get_blast_radius`), one row each with params and the REQ-16 annotations, and **every example call uses the prefixed name** — a doc test or grep proves no un-prefixed `list_agents`/`run_agent_on_pr`/`get_findings`/`get_conventions`/`get_blast_radius` string survives in the README. It shows **two** `devdigest_get_findings` examples, one per call shape (`run_id`, and `repo` + `pr`), documents `response_format` (naming both exact field lists), the `offset`/`limit` defaults (0 / 25, max 100), the "~2 min" review timeout (never "~90s"), and the process-lifetime cache limitation **together with** its `repo` + `pr` workaround; it states the studio (`./scripts/dev.sh`) must already be running. `AGENTS.md` follows `reviewer-core/AGENTS.md`'s 4-section shape; `INSIGHTS.md` is the standard stub. Root `README.md` gains an `mcp-server/` row in the package table. Every claim cites a real `file:line`. **Assign to `doc-writer`, not `implementer`.** |
| T15 | ci | ci | `.github/workflows/mcp-server.yml`, `TESTING.md` (suite-map row) | T13 | — | A workflow modelled on `.github/workflows/reviewer-core.yml` (npm, `cache-dependency-path: mcp-server/package-lock.json`, Node 22) running `npm ci && npm run typecheck && npm test`. Path filter covers `mcp-server/**`, `server/src/vendor/shared/**` (the type-only alias target — same rationale as the reviewer-core workflow's filter), and the workflow file itself. `TESTING.md`'s suite map gains the row. |
| T16 | e2e | e2e | — | T13 | — | **No e2e coverage, by decision.** `e2e/` drives a *browser* via `agent-browser`; a stdio MCP server has no browser surface, so there is nothing deterministic to assert there. Recorded so the omission is a decision, not an oversight. Manual verification is the MCP Inspector plus T14's config block. |

### Dependency graph

Authoritative edge list (`X → Y` = Y depends on X):

```
T1  → T2
T2  → T3, T5, T6
T3  → T4, T7, T8, T9, T10
T4  → T8, T9, T10
T5  → T8, T9
T6  → T7, T8, T9, T10
T8  → T9
T7  → T11
T9  → T11
T10 → T11
T11 → T12
T12 → T13
T13 → T14, T15, T16
```

Shape, for orientation (the edge list above is the source of truth):

```
T1 → T2 ─┬→ T3 → T4 ─┬→ T8 → T9 ─┐
         │           └→ T10 ─────┤
         ├→ T5 ──────────────────┤
         └→ T6 → T7 ─────────────┤
                                 ▼
                                T11 → T12 → T13 ─┬→ T14
                                                 ├→ T15
                                                 └→ T16
```

Acyclic — every edge points from a lower task number to a higher one, so no
cycle is possible. T9 now has **five** predecessors (T3, T4, T5, T6, T8): T4 for
the shared resolver behind its `repo` + `pr` path, T8 for the trimming and
`still_running` helpers. Both are strictly earlier than T9 in the order above,
so the parallel-safe sets are unchanged:
**{T4, T5}** after T3 · **{T7, T8, T10}** after T6 · **{T14, T15, T16}** after
T13. (T9 is in none of them, and never was.)

## Testing Strategy

- **mcp-server (unit)**: `cd mcp-server && npm run test:unit && npm run typecheck`
- **mcp-server (integration)**: `cd mcp-server && npm run test:it` — the
  `*.it.test.ts` lane. Unlike `server/`'s integration lane this needs **no
  Docker and no Postgres**; it stubs the DevDigest API with `node:http` on an
  ephemeral port and uses the SDK's in-memory transport pair. Any test that
  binds a socket or spawns a process **must** carry the `.it.test.ts` suffix so
  the fast/slow split stays honest.
- **mcp-server (all)**: `cd mcp-server && npm test`
- **Tool naming guard**: the namespaced names are asserted in three independent
  places — T6 (description constants), T11 (`tools/list` set comparison) and T13
  (real client `callTool`s) — so a partial rename cannot pass CI.
- **Unchanged packages** — run once at the end to prove nothing regressed, since
  this plan touches none of them:
  - `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' && pnpm typecheck`
  - `cd client && pnpm test && pnpm typecheck`
  - `cd reviewer-core && npm test && npm run typecheck`
- **Manual smoke** (not automated, for the lesson demo): start the studio with
  `./scripts/dev.sh`, then run the MCP Inspector against
  `node mcp-server/dist/index.js` and call each of the 5 tools once — including
  `devdigest_get_findings` **both** ways (`run_id`, and `repo` + `pr`).
- New tests are added only where a task's Acceptance criterion names one — all
  of them live under `mcp-server/test/`.

## Risks & Mitigations

- **zod floor conflict (highest-value risk).** The SDK's peer range is
  `^3.25 || ^4.0`; this repo pins `^3.24.1` everywhere else, which is *below*
  that floor. *Mitigation:* `mcp-server` pins its own `zod@^3.25` in its own
  lockfile, imports `@devdigest/shared` **type-only**, and T1's acceptance
  requires `npm ls zod` to report exactly one version ≥ 3.25.
- **`TS2589: Type instantiation is excessively deep`** — hit for real during T8/T10
  implementation, and **not** caused by `@devdigest/shared` at all (the escape
  hatch above never had to be used). Root cause, verified: `npm ls zod --all`
  showed exactly **one physical** `zod` install (`node_modules/zod@3.25.76`,
  deduped), so this was never a duplicate-package problem. The real cause is
  that zod ≥3.25 ships **three separate type entry points** in one package —
  `zod` (`.` → `src/index.ts`), `zod/v3` (→ `src/v3/index.ts`), `zod/v4`
  (→ `src/v4/index.ts`) — confirmed via `zod/package.json`'s `exports` map.
  `@modelcontextprotocol/sdk@1.30.0`'s `server/zod-compat.d.ts` types
  `AnySchema` as `import type * as z3 from 'zod/v3'` — i.e. it requires schemas
  built against the **`zod/v3` subpath specifically**, not the bare `'zod'`
  entry. A schema built via `import { z } from 'zod'` (bare) and a type built
  via `import type * as z3 from 'zod/v3'` are two **structurally distinct**
  declarations even though they come from the same installed package version —
  TypeScript does not unify them, producing exactly this error at every
  `registerTool(...)` call site. **Fix, verified working (`npm run typecheck`
  clean, all 88 tests still green):** `mcp-server/src/schemas.ts`'s single
  import line changed from `import { z } from 'zod'` to
  `import { z } from 'zod/v3'` — nothing else in the file changes, since
  `zod/v3` is the classic v3 API surface (same `z.string()`/`.number()`/
  `.enum()`/etc. runtime behavior). Because every tool file imports its Zod
  validators **from `schemas.ts`**, not by calling `zod` directly, this one-line
  fix at the source was sufficient — T9 and T11 (not yet implemented as of this
  edit) do not need their own zod import changes as long as they keep reusing
  `schemas.ts`'s exports rather than constructing new schemas inline. If a
  future task *does* need to define a new zod schema of its own anywhere in
  `mcp-server/`, it must import from `'zod/v3'`, never the bare `'zod'`. The
  `"zod": ["./node_modules/zod"]` tsconfig path from T1 is harmless but was not
  what fixed this — it addresses physical-instance dedup, which was never the
  actual problem here.
- **`npm run build` nests output instead of producing a flat `dist/index.js`.**
  Found during T12. `tsconfig.json`'s `@devdigest/shared` path alias points at
  a real `.ts` file outside `mcp-server/` (`../server/src/vendor/shared/index.ts`),
  so `tsc` pulls it into the compiled program for type resolution even though
  every use is `import type` and is fully erased at emit time (verified: the
  emitted `.js` files contain zero references to the vendor path). Because that
  file sits outside any `rootDir` this package could declare, `tsc` computes
  the emit root as the repo-level common ancestor instead of `src/`, producing
  `dist/mcp-server/src/index.js` plus a dead, never-imported copy of the vendor
  tree's compiled output under `dist/server/**`. **Setting `"rootDir": "src"`
  looks like the fix but is not** — it makes `tsc` refuse to compile at all
  (`TS6059: File ... is not under 'rootDir'`), and this fires even under
  `--noEmit`, so it would have broken `npm run typecheck` too, not just the
  build. *Fix, verified working (`npm run build` exit 0, flat `dist/index.js`,
  `node dist/index.js` starts / stays alive / empty stdout / clean `SIGTERM`
  exit, all 114 tests + typecheck still green):* keep `tsconfig.json` without
  `rootDir` (tsc's default nesting stands), and add a tiny post-build script,
  `mcp-server/scripts/flatten-dist.mjs`, that copies `dist/mcp-server/src/**`
  up to `dist/**` and deletes the now-empty `dist/mcp-server` tree plus the
  dead `dist/server` tree. `package.json`'s `"build"` script is now
  `"tsc -p tsconfig.json && node scripts/flatten-dist.mjs"`. T14's README
  `mcpServers` JSON block and `claude mcp add` example should point at this
  now-genuinely-flat `<abs>/mcp-server/dist/index.js` — that path is correct
  as originally planned, it just needed the flatten step to actually exist.
- **SDK API drift / v2 rename.** The SDK's `main` branch is already an
  unpublished v2 beta under a **different package name**
  (`@modelcontextprotocol/server`) with a different API (`serveStdio`).
  *Mitigation:* T1 pins **exactly** `1.30.0`; all API facts in this plan are
  verified against that tag. Do not follow v2 docs.
- **Using the deprecated `server.tool(...)`.** Seven deprecated overloads still
  exist and will "work", so this fails silently as tech debt. *Mitigation:* T11's
  acceptance names `registerTool` explicitly.
- **Passing `z.object({...})` as `inputSchema`.** SDK 1.30.0 wants a raw object
  of validators; wrapping it is the most likely single implementation mistake.
  *Mitigation:* called out in the SDK-facts section and in T6's acceptance.
- **The "exactly one of `run_id` / `repo`+`pr`" rule has no home in the schema.**
  Because `inputSchema` is a raw validator object (`mcp.d.ts:150-157`), there is
  no `.refine()` hook, so all three fields must be optional and a sloppy handler
  would silently accept "neither" (returning nothing) or "both" (picking one
  arbitrarily) — the exact dead-end REQ-8 forbids. *Mitigation:* the guard is an
  exported, separately unit-tested function (T6) invoked first in T9's handler,
  with all four bad combinations asserted in both T6 and T9.
- **Invented annotation fields.** `ToolAnnotations` has exactly five optional
  fields (`types.d.ts:2361-2367`); anything else is silently dropped or rejected.
  *Mitigation:* the shape is recorded in the SDK-facts section with its
  `file:line`, REQ-16 fixes the exact values per tool, and T11 deep-equals them
  against the client-visible `tools/list` output.
- **`GET /repos/:id/pulls` is slow.** It syncs from GitHub and backfills diff
  stats for up to 10 PRs per call (`pulls/service.ts:36-105`), each a separate
  GitHub round trip. *Mitigation:* resolution gets its own `resolveTimeoutMs`
  (default 20 s) separate from the review budget, and the call degrades to
  persisted PRs when no token is configured (`pulls/service.ts:31,69`) — so it
  still works offline. Note this now also sits on `devdigest_get_findings`'s
  `repo` + `pr` path, which is why that path reuses the same resolver and the
  same separate timeout rather than borrowing the review budget.
- **Rate limiting.** The API allows 120 req/min globally and 10/min on
  `POST /pulls/:id/review` (`server/README.md:54`). A 2 s poll over the
  **120 s** review budget is **~60 poll requests spread across two minutes ≈ 30
  req/min**, plus ~3 resolution calls and 1 review POST per tool call —
  comfortably inside the global cap, and each tool call triggers exactly one
  review POST. *Mitigation:* T2 rejects `pollIntervalMs < 1000` (which would
  otherwise put a 120 s run at up to 120 req/min, exactly at the cap).
- **Stale contract comment misleads a future reader.** `review-api.ts:40-44`
  claims the run is synchronous. *Mitigation:* Context Finding 1 records the
  truth with `file:line` evidence; the do-not-touch file is not edited.
- **Cache loss across restarts.** `devdigest_get_findings` cannot resolve a
  `run_id` from a previous process. *Mitigation:* this is now **recoverable
  without a backend change** — the `repo` + `pr` path resolves the most recent
  run for the PR with no cache involved, and the cache-miss message leads with
  exactly that instruction (T9(b)), backed by the documented limitation in the
  README (T14). A `run_id`-scoped findings endpoint would still be the tidier
  fix and remains deliberately out of scope.
- **"Most recent run" is a client-side judgement.** `GET /pulls/:id/runs`
  happens to return rows newest-first today (`run.repo.ts:50`) but that ordering
  is not part of the published contract, and `RunSummary.ran_at` is typed
  nullable (`trace.ts:113`). *Mitigation:* T9 sorts defensively on `ran_at`
  itself (null = oldest) and its fixture deliberately returns rows out of order,
  so a future server-side ordering change cannot silently pick the wrong run.
- **Studio not running.** Every tool fails if `:3001` is down. *Mitigation:*
  `GET /health` connectivity check surfaces "start the studio with
  `./scripts/dev.sh`" instead of a raw `ECONNREFUSED`.
- **stdout corruption.** A single stray `console.log` breaks the transport with
  a `SyntaxError` in the host. *Mitigation:* the automated grep assertion in
  T12, not just a convention.

## Out of Scope

- **Real Blast Radius.** `devdigest_get_blast_radius` ships as a typed stub. The
  real implementation reads `repo-intel` (root `README.md:85`,
  `server/src/modules/repo-intel/README.md:10-12`) and — since no HTTP endpoint
  exposes it today — will require a **new server endpoint**, i.e. a separate
  plan that is allowed to touch `server/`.
- **Any change to `server/`, `client/`, `reviewer-core/`,** including a
  `run_id`-scoped findings endpoint that would obsolete the in-memory cache.
- **Acting on findings from MCP.** `devdigest_get_findings`'s *detailed* mode
  exposes `id`/`review_id` so a future `devdigest_accept_finding` /
  `devdigest_dismiss_finding` tool could call
  `POST /findings/:id/accept|dismiss` (`reviews/routes.ts:143-147`) — but no
  such tool is in this plan (REQ-5 fixes the count at 5).
- **Cursor-based or cross-review pagination.** `offset`/`limit` address one
  resolved review's findings array only; paging across runs or reviews is not
  supported.
- **Making `POST /pulls/:id/review` synchronous**, or consuming
  `/runs/:id/events` (SSE) from the MCP server. Polling is sufficient and far
  simpler.
- **MCP resources, prompts, sampling, elicitation**, and mandatory
  `outputSchema`/`structuredContent` — this server exposes tools only, returning
  JSON-serialized text content.
- **Lazy tool loading / tool-search.** Five tools with small flat schemas is
  already a negligible context footprint; adding indirection would be
  over-engineering.
- **Remote/hosted MCP transport, authentication, multi-workspace support.** The
  local API is single-workspace with no auth
  (`modules/_shared/context.ts:9-23`).
- Architecture review and security review are performed by separate reviewer
  agents/skills (the `security` skill, `pr-self-review`, code-review) — not by
  `planner` or `implementer`.
