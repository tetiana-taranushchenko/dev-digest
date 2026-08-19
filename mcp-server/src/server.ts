// Composition of the 5 tools onto one `McpServer` instance.
//
// `createMcpServer` is deliberately **transport-free**: it never imports
// `StdioServerTransport` (or any other transport). That is what keeps it
// testable in-process via `InMemoryTransport.createLinkedPair()`
// (`test/server.test.ts`) without spawning a child process or touching
// stdio. T12 (`src/index.ts`, not yet built) is the only file that reads
// `process.env`, builds the `DevDigestApiClient` + `RunCache` from that
// config, calls this function, and then connects a real
// `StdioServerTransport` to the returned server.
//
// Internal layering (plan's "Internal layering (dependency direction)"):
//   index.ts (transport/entry) -> server.ts (this file, registers tools)
//     -> tools/*.ts -> api/client.ts + api/resolve.ts + runs/run-cache.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DevDigestApiClient } from './api/client.js';
import type { RunCache } from './runs/run-cache.js';
import { registerGetBlastRadiusTool } from './tools/get-blast-radius.js';
import { registerGetConventionsTool } from './tools/get-conventions.js';
import { registerGetFindingsTool } from './tools/get-findings.js';
import { registerListAgentsTool } from './tools/list-agents.js';
import { registerRunAgentOnPrTool } from './tools/run-agent-on-pr.js';
import { SERVER_INSTRUCTIONS } from './tools/shared-context.js';

/** Matches `package.json`'s `version` field — this package is not published, so a literal is fine. */
const SERVER_VERSION = '0.0.0';

/**
 * Everything `createMcpServer` needs to wire up all 5 tools. A single flat
 * bag rather than per-tool deps objects, so the composition root (T12) only
 * has to build one `DevDigestApiClient` and one `RunCache` and pass them
 * once; `createMcpServer` fans them out to each tool's own `*Deps` shape
 * (`ListAgentsDeps`, `RunAgentOnPrDeps`, `GetFindingsDeps`,
 * `GetConventionsDeps`, `GetBlastRadiusDeps`).
 */
export interface CreateMcpServerDeps {
  client: DevDigestApiClient;
  runCache: RunCache;
  /** T2's `loadConfig().reviewTimeoutMs` (REQ-7, default 120000, "~2 min"). */
  reviewTimeoutMs: number;
  /** T2's `loadConfig().pollIntervalMs` (default 2000). */
  pollIntervalMs: number;
}

/**
 * Builds a `McpServer` with all 5 `devdigest_*` tools registered and the
 * REQ-11 glossary set as the server-level `instructions`. Transport-free —
 * the caller is responsible for connecting a transport (stdio in
 * production, `InMemoryTransport` in tests).
 */
export function createMcpServer(deps: CreateMcpServerDeps): McpServer {
  const server = new McpServer(
    { name: 'devdigest', version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerListAgentsTool(server, { client: deps.client });
  registerRunAgentOnPrTool(server, {
    client: deps.client,
    runCache: deps.runCache,
    reviewTimeoutMs: deps.reviewTimeoutMs,
    pollIntervalMs: deps.pollIntervalMs,
  });
  registerGetFindingsTool(server, { client: deps.client, runCache: deps.runCache });
  registerGetConventionsTool(server, { client: deps.client });
  registerGetBlastRadiusTool(server, {});

  return server;
}
