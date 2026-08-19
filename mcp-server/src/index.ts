// Composition root & stdio entry point.
//
// This is the **only** file in `mcp-server/` that reads `process.env`
// (REQ-13/T12) — it feeds the raw values into T2's pure `loadConfig`, builds
// the `DevDigestApiClient` + `RunCache`, calls T11's transport-free
// `createMcpServer`, and connects a real `StdioServerTransport` (T11's
// `server.ts` deliberately never imports the transport itself, so this file
// is the one place that does).
//
// stdout is reserved for the JSON-RPC wire on the stdio transport (REQ-13):
// a stray write there breaks the host with a JSON parse error. All
// diagnostics in this file therefore go to stderr via `console.error` /
// `process.stderr.write` — never `console.log` / `process.stdout.write`.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DevDigestApiClient } from './api/client.js';
import { loadConfig } from './config.js';
import { RunCache } from './runs/run-cache.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  // The one `process.env` read in this package (T12's composition root).
  const config = loadConfig(process.env);

  const client = new DevDigestApiClient({
    baseUrl: config.apiBaseUrl,
    fetch: globalThis.fetch,
  });
  const runCache = new RunCache();

  const server: McpServer = createMcpServer({
    client,
    runCache,
    reviewTimeoutMs: config.reviewTimeoutMs,
    pollIntervalMs: config.pollIntervalMs,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Diagnostic only — never stdout (REQ-13).
  console.error(`devdigest MCP server started (API base URL: ${config.apiBaseUrl})`);

  let shuttingDown = false;
  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`devdigest MCP server received ${signal}, shutting down...`);
    try {
      await server.close();
    } catch (err) {
      console.error('Error while closing devdigest MCP server:', err);
    } finally {
      process.exit(0);
    }
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((err) => {
  console.error('Fatal error starting devdigest MCP server:', err);
  process.exit(1);
});
