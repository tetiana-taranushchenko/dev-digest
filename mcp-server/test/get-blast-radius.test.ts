import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient, type FetchLike } from '../src/api/client.js';
import { registerGetBlastRadiusTool } from '../src/tools/get-blast-radius.js';
import { getBlastRadiusInputSchema } from '../src/schemas.js';
import { GET_BLAST_RADIUS_DESCRIPTION } from '../src/tools/shared-context.js';

const BASE_URL = 'http://localhost:3001';
const PULL = { id: 'pr-1', number: 482 };

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
  registerGetBlastRadiusTool(server, { client: apiClient });

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

/** Records every request path so tests can assert the blast route is hit exactly once. */
function makeFetch(routes: Record<string, unknown>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch = vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace(BASE_URL, '');
    calls.push(path);
    if (!(path in routes)) {
      throw new Error(`Unexpected request in test: ${path}`);
    }
    return jsonResponse(200, routes[path]);
  }) as FetchLike;
  return { fetch, calls };
}

function baseRoutes(blastPayload: unknown): Record<string, unknown> {
  return {
    [`/pulls/${PULL.id}`]: { id: PULL.id, number: PULL.number },
    [`/pulls/${PULL.id}/blast`]: blastPayload,
  };
}

describe('devdigest_get_blast_radius', () => {
  let harness: Harness;

  afterEach(async () => {
    await harness?.client.close();
    vi.clearAllMocks();
  });

  it('resolves pr_id -> pull -> calls GET /pulls/:id/blast exactly once and returns status: ok with the server\'s caller_count values', async () => {
    const blastPayload = {
      changed_symbols: [{ name: 'helper', file: 'src/helper.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'helper',
          file: 'src/helper.ts',
          caller_count: 23,
          callers: [
            { name: 'caller1', file: 'src/a.ts', line: 10 },
            { name: 'caller2', file: 'src/b.ts', line: 20 },
          ],
          endpoints_affected: ['GET /api/things'],
          crons_affected: [],
        },
      ],
      summary: '',
      state: 'ok',
      reason: null,
      reason_text: null,
      truncated: true,
      index_status: 'full',
      generated_at: '2026-08-20T00:00:00.000Z',
    };
    const { fetch, calls } = makeFetch(baseRoutes(blastPayload));
    harness = await setup(fetch);

    const result = await harness.client.callTool({
      name: 'devdigest_get_blast_radius',
      arguments: { pr_id: PULL.id },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      pr_id: string;
      index_status: string;
      truncated: boolean;
      changed_symbols: unknown[];
      downstream: Array<{ symbol: string; caller_count: number; callers: unknown[] }>;
    };

    expect(body.status).toBe('ok');
    expect(body.pr_id).toBe(PULL.id);
    expect(body.index_status).toBe('full');
    expect(body.truncated).toBe(true);
    expect(body.downstream).toHaveLength(1);
    // Same caller_count the route returned — not re-derived from callers.length.
    expect(body.downstream[0]!.caller_count).toBe(23);
    expect(body.downstream[0]!.callers).toEqual([
      { file: 'src/a.ts', line: 10, name: 'caller1' },
      { file: 'src/b.ts', line: 20, name: 'caller2' },
    ]);

    // The blast route was hit exactly once.
    expect(calls.filter((path) => path === `/pulls/${PULL.id}/blast`)).toHaveLength(1);
  });

  it('maps state: empty to status: empty with an actionable message, never a bare empty array', async () => {
    const blastPayload = {
      changed_symbols: [],
      downstream: [],
      summary: '',
      state: 'empty',
      reason: 'no_impact',
      reason_text: 'No callers, endpoints, or crons were affected by this change.',
      truncated: false,
      index_status: 'full',
      generated_at: '2026-08-20T00:00:00.000Z',
    };
    const { fetch } = makeFetch(baseRoutes(blastPayload));
    harness = await setup(fetch);

    const result = await harness.client.callTool({
      name: 'devdigest_get_blast_radius',
      arguments: { pr_id: PULL.id },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      message: string;
      downstream: unknown[];
    };
    expect(body.status).toBe('empty');
    expect(body.message).toBe('No callers, endpoints, or crons were affected by this change.');
    expect(body.downstream).toEqual([]);
  });

  it.each(['partial', 'degraded'] as const)(
    'maps state: %s to the same status string, with message = the server\'s reason_text',
    async (state) => {
      const blastPayload = {
        changed_symbols: [{ name: 'helper', file: 'src/helper.ts', kind: 'function' }],
        downstream: [],
        summary: '',
        state,
        reason: state === 'partial' ? 'index_partial' : 'index_failed',
        reason_text: `The repo-intel index is ${state} for this repo.`,
        truncated: false,
        index_status: state,
        generated_at: '2026-08-20T00:00:00.000Z',
      };
      const { fetch } = makeFetch(baseRoutes(blastPayload));
      harness = await setup(fetch);

      const result = await harness.client.callTool({
        name: 'devdigest_get_blast_radius',
        arguments: { pr_id: PULL.id },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never) as { status: string; message: string };
      expect(body.status).toBe(state);
      expect(body.message).toBe(`The repo-intel index is ${state} for this repo.`);
    },
  );

  it('an unresolvable pr_id surfaces the resolver actionable error, without calling the blast route', async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url.replace(BASE_URL, ''));
      return jsonResponse(404, { error: { code: 'not_found', message: 'Pull request not found' } });
    }) as FetchLike;
    harness = await setup(fetch);

    const result = await harness.client.callTool({
      name: 'devdigest_get_blast_radius',
      arguments: { pr_id: 'pr-does-not-exist' },
    });

    expect(result.isError).toBe(true);
    const body = parseResultText(result as never) as { status: string; message: string };
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/pr-does-not-exist/);
    expect(body.message).toMatch(/internal DevDigest id/);
    expect(calls.some((path) => path.endsWith('/blast'))).toBe(false);
  });

  it('description no longer states the stub warning and mentions the ok/empty/partial/degraded states', () => {
    expect(GET_BLAST_RADIUS_DESCRIPTION).not.toMatch(/not.{0,20}implement/i);
    expect(GET_BLAST_RADIUS_DESCRIPTION).toMatch(/ok, empty, partial, or degraded/);
  });

  it('is registered with annotations exactly { readOnlyHint: true, destructiveHint: false }', async () => {
    const { fetch } = makeFetch(baseRoutes({ changed_symbols: [], downstream: [], summary: '', state: 'empty', reason: 'no_impact', reason_text: 'none', truncated: false, index_status: 'full', generated_at: '2026-08-20T00:00:00.000Z' }));
    harness = await setup(fetch);

    const { tools } = await harness.client.listTools();
    const tool = tools.find((t) => t.name === 'devdigest_get_blast_radius');

    expect(tool).toBeDefined();
    expect(tool!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
    expect(tool!.description).toBe(GET_BLAST_RADIUS_DESCRIPTION);
  });

  describe('input schema shape', () => {
    it('is exactly { pr_id }, required, matching devdigest_run_agent_on_pr/devdigest_get_findings', () => {
      expect(Object.keys(getBlastRadiusInputSchema).sort()).toEqual(['pr_id']);
      expect(getBlastRadiusInputSchema.pr_id.isOptional()).toBe(false);
    });
  });
});
