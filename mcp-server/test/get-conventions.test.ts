import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient, type FetchLike } from '../src/api/client.js';
import * as resolveModule from '../src/api/resolve.js';
import { registerGetConventionsTool } from '../src/tools/get-conventions.js';

vi.mock('../src/api/resolve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/resolve.js')>();
  return {
    ...actual,
    resolveRepo: vi.fn(actual.resolveRepo),
  };
});

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

async function setup(fetchImpl: FetchLike): Promise<Harness> {
  const apiClient = new DevDigestApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
  const server = new McpServer({ name: 'devdigest-test', version: '0.0.0' });
  registerGetConventionsTool(server, { client: apiClient });

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

function makeFetch(routes: Record<string, unknown>): FetchLike {
  return vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace(BASE_URL, '');
    if (!(path in routes)) {
      throw new Error(`Unexpected request in test: ${path}`);
    }
    return jsonResponse(200, routes[path]);
  }) as FetchLike;
}

describe('devdigest_get_conventions', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.client.close();
    vi.clearAllMocks();
  });

  it('returns conventions trimmed to exactly {category, rule, evidence_ref, confidence, accepted}, via the shared resolver', async () => {
    const fullConventionRow = {
      id: 'conv-1',
      category: 'testing',
      rule: 'Use vitest, not jest.',
      evidence_path: 'src/foo.test.ts',
      evidence_line: 12,
      evidence_snippet: "import { describe } from 'vitest'",
      evidence_ref: 'src/foo.test.ts:12',
      confidence: 0.9,
      status: 'approved',
      accepted: true,
    };
    const fetchMock = makeFetch({
      '/repos': [{ id: 'r1', full_name: 'acme/payments-api' }],
      '/repos/r1/conventions': [fullConventionRow],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool({
      name: 'devdigest_get_conventions',
      arguments: { repo: 'acme/payments-api' },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      conventions: Array<Record<string, unknown>>;
    };
    expect(body.conventions).toHaveLength(1);
    expect(Object.keys(body.conventions[0]!).sort()).toEqual(
      ['accepted', 'category', 'confidence', 'evidence_ref', 'rule'].sort(),
    );
    expect(body.conventions[0]).toEqual({
      category: 'testing',
      rule: 'Use vitest, not jest.',
      evidence_ref: 'src/foo.test.ts:12',
      confidence: 0.9,
      accepted: true,
    });

    // The GET /repos lookup is not duplicated per tool — this is T4's shared
    // resolveRepo, actually invoked, not a reimplementation.
    expect(resolveModule.resolveRepo).toHaveBeenCalledTimes(1);
    expect(resolveModule.resolveRepo).toHaveBeenCalledWith(expect.anything(), 'acme/payments-api');
  });

  it('an empty convention list yields an actionable message pointing at the extractor, not a bare []', async () => {
    const fetchMock = makeFetch({
      '/repos': [{ id: 'r1', full_name: 'acme/payments-api' }],
      '/repos/r1/conventions': [],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool({
      name: 'devdigest_get_conventions',
      arguments: { repo: 'acme/payments-api' },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      message: string;
      conventions: unknown[];
    };
    expect(body.conventions).toEqual([]);
    expect(body.status).toBe('empty');
    expect(body.message).toMatch(/conventions/i);
    expect(body.message).not.toBe('[]');
  });

  it('an unresolvable repo surfaces the resolver actionable error, not a crash', async () => {
    const fetchMock = makeFetch({
      '/repos': [{ id: 'r1', full_name: 'acme/other' }],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool({
      name: 'devdigest_get_conventions',
      arguments: { repo: 'acme/missing' },
    });

    expect(result.isError).toBe(true);
    const body = parseResultText(result as never) as { message: string };
    expect(body.message).toMatch(/acme\/other/);
  });

  it('is registered with annotations exactly { readOnlyHint: true, destructiveHint: false }', async () => {
    const fetchMock = makeFetch({
      '/repos': [{ id: 'r1', full_name: 'acme/payments-api' }],
      '/repos/r1/conventions': [],
    });
    harness = await setup(fetchMock);

    const { tools } = await harness.client.listTools();
    const tool = tools.find((t) => t.name === 'devdigest_get_conventions');

    expect(tool).toBeDefined();
    expect(tool!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
    expect(tool!.description).toBeTruthy();
  });
});
