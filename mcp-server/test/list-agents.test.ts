import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient, type FetchLike } from '../src/api/client.js';
import { registerListAgentsTool } from '../src/tools/list-agents.js';

const BASE_URL = 'http://localhost:3001';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Harness {
  client: Client;
  server: McpServer;
}

/**
 * Wires a fresh `McpServer` (with only `devdigest_list_agents` registered)
 * to a real MCP `Client` over `InMemoryTransport.createLinkedPair()`, backed
 * by `fetchImpl` — no real network, no child process (mirrors the plan's
 * "Testing" note on `InMemoryTransport`).
 */
async function setup(fetchImpl: FetchLike): Promise<Harness> {
  const apiClient = new DevDigestApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
  const server = new McpServer({ name: 'devdigest-test', version: '0.0.0' });
  registerListAgentsTool(server, { client: apiClient });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, server };
}

function parseResultText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const block = result.content[0];
  expect(block?.type).toBe('text');
  return JSON.parse(block!.text!);
}

describe('devdigest_list_agents', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.client.close();
  });

  it('returns agents trimmed to exactly {id, name, description, enabled, model}', async () => {
    const fullAgentRow = {
      id: 'agent-1',
      name: 'Security Reviewer',
      description: 'Flags security issues.',
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      system_prompt: 'You are a security reviewer...',
      output_schema: null,
      enabled: true,
      version: 3,
      strategy: 'single-pass',
      ci_fail_on: 'critical',
      repo_intel: true,
      skill_count: 2,
    };
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, [fullAgentRow]));
    harness = await setup(fetchMock);

    const result = await harness.client.callTool({
      name: 'devdigest_list_agents',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { agents: Array<Record<string, unknown>> };
    expect(body.agents).toHaveLength(1);
    expect(Object.keys(body.agents[0]!).sort()).toEqual(
      ['description', 'enabled', 'id', 'model', 'name'].sort(),
    );
    expect(body.agents[0]).toEqual({
      id: 'agent-1',
      name: 'Security Reviewer',
      description: 'Flags security issues.',
      enabled: true,
      model: 'claude-sonnet-5',
    });
  });

  it('an empty agent list yields an actionable message, not a bare []', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, []));
    harness = await setup(fetchMock);

    const result = await harness.client.callTool({
      name: 'devdigest_list_agents',
      arguments: {},
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      message: string;
      agents: unknown[];
    };
    expect(body.agents).toEqual([]);
    expect(body.status).toBe('empty');
    expect(body.message.length).toBeGreaterThan(0);
    expect(body.message).not.toBe('[]');
  });

  it('is registered with annotations exactly { readOnlyHint: true, destructiveHint: false }', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, []));
    harness = await setup(fetchMock);

    const { tools } = await harness.client.listTools();
    const tool = tools.find((t) => t.name === 'devdigest_list_agents');

    expect(tool).toBeDefined();
    expect(tool!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
  });
});
