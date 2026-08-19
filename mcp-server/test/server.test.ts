import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient, type FetchLike } from '../src/api/client.js';
import { RunCache } from '../src/runs/run-cache.js';
import { createMcpServer } from '../src/server.js';
import { SERVER_INSTRUCTIONS } from '../src/tools/shared-context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3001';

const EXPECTED_TOOL_NAMES = [
  'devdigest_list_agents',
  'devdigest_run_agent_on_pr',
  'devdigest_get_findings',
  'devdigest_get_conventions',
  'devdigest_get_blast_radius',
] as const;

/** A fetch stub that is never expected to be called — `tools/list` and `initialize` never call it. */
function unusedFetch(): FetchLike {
  return vi.fn<FetchLike>(async () => {
    throw new Error('Unexpected fetch call in server.test.ts — no tool is invoked in this suite.');
  });
}

interface Harness {
  client: Client;
}

async function setup(): Promise<Harness> {
  const apiClient = new DevDigestApiClient({ baseUrl: BASE_URL, fetch: unusedFetch() });
  const server = createMcpServer({
    client: apiClient,
    runCache: new RunCache(),
    reviewTimeoutMs: 120_000,
    pollIntervalMs: 2_000,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client };
}

describe('createMcpServer', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.client.close();
  });

  it('is transport-free — src/server.ts never imports the stdio transport', () => {
    const source = readFileSync(join(__dirname, '../src/server.ts'), 'utf-8');
    // Only reject an actual import of the transport module (a doc comment
    // mentioning the class name in prose is fine and expected).
    expect(source).not.toMatch(/from ['"]@modelcontextprotocol\/sdk\/server\/stdio\.js['"]/);
  });

  it('registers exactly the 5 devdigest_* tools, each with a non-empty description', async () => {
    harness = await setup();

    const { tools } = await harness.client.listTools();

    expect(new Set(tools.map((tool) => tool.name))).toEqual(new Set(EXPECTED_TOOL_NAMES));
    expect(tools).toHaveLength(EXPECTED_TOOL_NAMES.length);

    for (const tool of tools) {
      expect(typeof tool.description).toBe('string');
      expect(tool.description!.length).toBeGreaterThan(0);
    }
  });

  it("advertises the server's instructions as SERVER_INSTRUCTIONS (REQ-11)", async () => {
    harness = await setup();

    // Ensure the initialize handshake has completed before reading instructions.
    await harness.client.listTools();

    expect(harness.client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
  });

  it('registers each tool with the exact REQ-16 annotations', async () => {
    harness = await setup();

    const { tools } = await harness.client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    const readOnly = { readOnlyHint: true, destructiveHint: false };
    const mutating = {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    };

    expect(byName.get('devdigest_list_agents')!.annotations).toEqual(readOnly);
    expect(byName.get('devdigest_get_findings')!.annotations).toEqual(readOnly);
    expect(byName.get('devdigest_get_conventions')!.annotations).toEqual(readOnly);
    expect(byName.get('devdigest_get_blast_radius')!.annotations).toEqual(readOnly);
    expect(byName.get('devdigest_run_agent_on_pr')!.annotations).toEqual(mutating);
  });
});
