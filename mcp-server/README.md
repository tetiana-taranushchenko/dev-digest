# `@devdigest/mcp-server` — local stdio MCP server

A standalone, local-only package that speaks [MCP](https://modelcontextprotocol.io)
over **stdio** to Claude Desktop / Claude Code. It is a **pure HTTP client** of
the already-running local DevDigest API (`http://localhost:3001` by default) —
no database, no filesystem access to another package's code, no HTTP listener
of its own. It exposes 5 namespaced tools (`devdigest_*`) that let an MCP
client list agents, trigger a review and wait for its result, page through
findings, read a repo's extracted conventions, and — as a deliberate stub —
ask for a PR's blast radius.

## How it fits together

```mermaid
flowchart LR
  CLIENT["MCP client<br/>Claude Desktop / Claude Code"]
  CLIENT <-->|"stdio (JSON-RPC)"| SERVER["mcp-server/<br/>McpServer + 5 devdigest_* tools"]
  SERVER -->|"fetch (HTTP)"| API["server/<br/>Fastify API · :3001"]
```

The MCP client spawns `dist/index.js` as a subprocess and talks JSON-RPC over
its stdin/stdout (`src/index.ts:38-39`); `mcp-server` in turn calls the local
DevDigest API over plain `fetch` (`src/api/client.ts:72-197`). **The DevDigest
studio (`./scripts/dev.sh` from the repo root) must already be running on
`:3001`** for every tool except `devdigest_get_blast_radius` — that one makes
no HTTP call at all (`src/tools/get-blast-radius.ts:44-57`).

## The 5 tools

| Tool | Params | `annotations` | Notes |
|---|---|---|---|
| `devdigest_list_agents` | none | `readOnlyHint: true, destructiveHint: false` | Returns `{ id, name, description, enabled, model }` per agent (`src/tools/list-agents.ts:24-30,63`) |
| `devdigest_run_agent_on_pr` | `pr_id` (the PR's **internal** DevDigest id, not the GitHub PR number), `agent_id` (id or name) | `readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true` | The only mutating tool — one call does resolve → trigger → poll → fetch (`src/tools/run-agent-on-pr.ts:256-261`). Find `pr_id` in the DevDigest app (e.g. the `id` field in `GET /repos/:id/pulls`'s response, visible in the browser's network tab) or `GET /pulls/:id` |
| `devdigest_get_findings` | `pr_id` (same internal id as `devdigest_run_agent_on_pr`), `all_runs?` (default `false`) | `readOnlyHint: true, destructiveHint: false` | Gets the latest verdict + findings per agent for a PR, grouped by agent; `all_runs: true` returns every run instead of just each agent's latest (`src/tools/get-findings.ts:81`) |
| `devdigest_get_conventions` | `repo_id` (the repo's **internal** DevDigest id, not "owner/name") | `readOnlyHint: true, destructiveHint: false` | Returns `{ category, rule, evidence_ref, confidence, accepted }` per convention (`src/tools/get-conventions.ts:32-38,71`) |
| `devdigest_get_blast_radius` | `repo`, `pr` (both required) | `readOnlyHint: true, destructiveHint: false` | **Stub** — always `{status:'not_implemented',...}`, makes no HTTP call (`src/tools/get-blast-radius.ts:1-8,42-57`) |

Annotation values above are read verbatim from each tool's `registerTool(...)`
call, not from the plan — see the `file:line` refs in each row.

## Environment

`.env.example` (`mcp-server/.env.example:1-21`); every var is optional, with
the default applied by `loadConfig` (`src/config.ts:30-33`):

| Var | Default | Notes |
|---|---|---|
| `API_BASE_URL` | `http://localhost:3001` | Base URL of the local DevDigest API; a trailing slash is stripped (`src/config.ts:80-82`) |
| `REVIEW_TIMEOUT_MS` | `300000` | Max time `devdigest_run_agent_on_pr` polls before returning `still_running` — described to the model as **"~5 min"**, never "~90s" (`src/config.ts:31`, `src/tools/shared-context.ts:42,46`) |
| `POLL_INTERVAL_MS` | `2000` | Interval between polls of `GET /pulls/:id/runs`; rejected below `1000` (the API's global rate limit is 120 req/min) (`src/config.ts:32,37,75`) |
| `RESOLVE_TIMEOUT_MS` | `20000` | Timeout for the repo/PR/agent resolution HTTP calls (`src/config.ts:33`) |

## Connecting it to an MCP client

Build first (`npm run build`, see [Commands](#commands)), then point the
client at the flat `dist/index.js` the build produces
(`scripts/flatten-dist.mjs:15-18`). Every path below is the **exact** block —
replace `<abs>` with the absolute path to this repo's `mcp-server/` folder.

Claude Desktop / any `mcpServers`-style config:

```json
{"mcpServers":{"devdigest":{"command":"node","args":["<abs>/mcp-server/dist/index.js"],"env":{"API_BASE_URL":"http://localhost:3001"}}}}
```

Claude Code CLI equivalent:

```sh
claude mcp add --transport stdio devdigest -- node <abs>/dist/index.js
```

## Example calls

`devdigest_run_agent_on_pr` — one call does resolve → trigger → poll → fetch
(`src/tools/run-agent-on-pr.ts:250-385`); the returned `findings` use the
**run-result** projection — 9 keys: `severity`, `category`, `title`, `file`,
`start_line`, `end_line`, `rationale`, `suggestion`, `confidence`
(`src/tools/run-agent-on-pr.ts:77-87`):

```json
{"pr_id": "a23e635c-cb87-4230-8bb8-ff3fa63d1c30", "agent_id": "general"}
```

`devdigest_get_findings` — by `pr_id` (the same internal id
`devdigest_run_agent_on_pr` takes), grouped by agent, latest run per agent by
default:

```json
{"pr_id": "a23e635c-cb87-4230-8bb8-ff3fa63d1c30"}
```

Pass `all_runs: true` to get every run per agent instead of just each
agent's latest:

```json
{"pr_id": "a23e635c-cb87-4230-8bb8-ff3fa63d1c30", "all_runs": true}
```

No `run_id` lookup and no cache — `pr_id` alone is always enough to check on
a review, including one still running past `devdigest_run_agent_on_pr`'s
timeout (`src/tools/get-findings.ts:81-97`).

### The `reviews` array's per-entry shape

Each entry in the result's `reviews` array is one agent's (selected) run,
keyed by its own `status`:

- **`running`** — no `findings`/`verdict` yet.
- **`failed`** / **`cancelled`** — carries `error`, no `findings`.
- **`done`** — carries `verdict`, `summary`, `score`, and `findings`. Every
  finding uses the full detailed field set (`src/tools/run-agent-on-pr.ts:57-74`,
  `DETAILED_FINDING_FIELDS`, 11 keys: `severity`, `category`, `title`, `file`,
  `start_line`, `end_line`, `rationale`, `suggestion`, `confidence`, `id`,
  `review_id`) — there is no `response_format` toggle in this tool, since
  `id`/`review_id` (needed to call the server's `POST /findings/:id/accept` /
  `POST /findings/:id/dismiss`) are always included. Findings with a non-null
  `dismissed_at` are filtered out before projection
  (`src/tools/get-findings.ts:155-158`).

There is no `offset`/`limit` — every finding of every selected run is
returned in one call.

## Commands

From `package.json` (`mcp-server/package.json:7-15`):

| Script | What it does |
|---|---|
| `dev` | `tsx watch src/index.ts` |
| `build` | `tsc -p tsconfig.json` then `node scripts/flatten-dist.mjs` — the flatten step is needed because the `@devdigest/shared` type-only path alias points outside `src/`, which pushes `tsc`'s emit root up; the script copies the real output back to a flat `dist/index.js` (`scripts/flatten-dist.mjs:1-24`) |
| `start` | `node dist/index.js` |
| `typecheck` | `tsc --noEmit -p tsconfig.json` |
| `test` | `vitest run` (both lanes) |
| `test:unit` | `vitest run --exclude "**/*.it.test.ts"` — hermetic, injected fake fetch |
| `test:it` | `vitest run .it.test.ts` — drives the real MCP server over `InMemoryTransport` against a real loopback HTTP stub |

## Testing

See [Commands](#commands) above and [`../TESTING.md`](../TESTING.md) for the
repo-wide strategy.
