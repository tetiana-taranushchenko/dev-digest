# mcp-server (@devdigest/mcp-server)

## Before answering

Search `mcp-server/INSIGHTS.md` first — the answer may already be there.

## Conventions (not obvious from code)

- Tool `inputSchema`s are **raw objects of Zod validators**, not `z.object({...})` wrappers — the shape SDK 1.30.0's `registerTool` expects (`src/schemas.ts:1-14`).
- `@devdigest/shared` is consumed **type-only**, via the `reviewer-core/tsconfig.json` precedent (`tsconfig.json:23-24`) — never imported at runtime, never vendored.
- `zod` is pinned above the repo-wide `^3.24.1` floor (`package.json:18`: `^3.25.0`) because the MCP SDK's peer range requires it — this package's lockfile is independent of every other package's.
- Every tool name carries the `devdigest_` prefix (`src/schemas.ts`, `src/tools/*.ts`) so it stays unambiguous alongside other MCP servers in the same host.
- `src/index.ts` is the **only** file that reads `process.env`; everything else takes config injected (`src/config.ts`'s `loadConfig` is a pure function of an env object).
- No `console.log` / `process.stdout.write` anywhere in `src/**` — stdout is the JSON-RPC wire on the stdio transport; diagnostics go to stderr only (`src/index.ts:41-42,48,52`).

## Do-not-touch

- `server/src/vendor/shared/` — read only via the type-only tsconfig path alias; never edited or copied from here.

## Use when

- Purpose, tool table, env vars, connecting a client, commands → read [`mcp-server/README.md`](README.md)
- Findings/insights → read [`mcp-server/INSIGHTS.md`](INSIGHTS.md)
- Wrapping up non-trivial work in this package → run the `engineering-insights` skill; it only appends to [`mcp-server/INSIGHTS.md`](INSIGHTS.md) if something genuinely new and non-obvious came up, otherwise it does nothing
