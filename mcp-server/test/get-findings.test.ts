import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient, type FetchLike } from '../src/api/client.js';
import { registerGetFindingsTool } from '../src/tools/get-findings.js';

const BASE_URL = 'http://localhost:3001';

const PULL = { id: 'pr-1', number: 482 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FetchRoutes {
  pull?: () => unknown;
  runs?: () => unknown;
  reviews?: () => unknown;
}

/** A minimal router over the 3 endpoints devdigest_get_findings can touch, dispatched by path suffix + method. */
function createFetch(routes: FetchRoutes): FetchLike {
  return vi.fn<FetchLike>(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && /\/pulls\/[^/]+$/.test(url) && routes.pull) return jsonResponse(200, routes.pull());
    if (method === 'GET' && url.endsWith('/runs') && routes.runs) return jsonResponse(200, routes.runs());
    if (method === 'GET' && url.endsWith('/reviews') && routes.reviews) return jsonResponse(200, routes.reviews());

    throw new Error(`Unhandled/unexpected request in test fetch mock: ${method} ${url}`);
  });
}

interface Harness {
  client: Client;
  server: McpServer;
}

async function setup(fetchImpl: FetchLike): Promise<Harness> {
  const apiClient = new DevDigestApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
  const server = new McpServer({ name: 'devdigest-test', version: '0.0.0' });
  registerGetFindingsTool(server, { client: apiClient });

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

function callArgs(args: Record<string, unknown> = {}) {
  return { name: 'devdigest_get_findings', arguments: { pr_id: PULL.id, ...args } };
}

function makeFinding(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'f1',
    review_id: 'review-1',
    severity: 'WARNING',
    category: 'style',
    title: 'Missing return type',
    file: 'src/x.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'Explicit return types improve readability.',
    suggestion: 'Add : void',
    confidence: 0.8,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function makeRunSummary(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    run_id: 'run-1',
    agent_id: 'agent-1',
    agent_name: 'Security Reviewer',
    status: 'done',
    error: null,
    ran_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeReview(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'review-1',
    pr_id: PULL.id,
    agent_id: 'agent-1',
    run_id: 'run-1',
    agent_name: 'Security Reviewer',
    verdict: 'approve',
    summary: 'Looks fine',
    score: 92,
    findings: [makeFinding()],
    ...overrides,
  };
}

describe('devdigest_get_findings', () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.client.close();
    harness = undefined;
  });

  it('an unknown pr_id surfaces an actionable ResolveError-derived message, isError: true', async () => {
    const fetchMock: FetchLike = vi.fn(async () =>
      jsonResponse(404, { error: { code: 'not_found', message: 'Pull request not found' } }),
    ) as FetchLike;
    harness = await setup(fetchMock);

    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBe(true);
    const body = parseResultText(result as never) as { status: string; message: string };
    expect(body.status).toBe('error');
    expect(body.message).toMatch(/internal DevDigest id/);
  });

  it('a PR with zero runs at all -> actionable message naming devdigest_run_agent_on_pr, not a bare empty result', async () => {
    const fetchMock = createFetch({
      pull: () => PULL,
      runs: () => [],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBe(true);
    const body = parseResultText(result as never) as { status: string; message: string };
    expect(body.status).toBe('error');
    expect(body.message).toContain(`PR #${PULL.number}`);
    expect(body.message).toContain('devdigest_run_agent_on_pr');
    expect(body.message).toContain(PULL.id);
  });

  it('one agent, one done run -> completed with pr_id/pr and the review nested inside, dismissed findings excluded', async () => {
    const kept = makeFinding({ id: 'f1', title: 'Kept' });
    const dismissed = makeFinding({ id: 'f2', title: 'Dropped', dismissed_at: '2024-02-01T00:00:00Z' });
    const fetchMock = createFetch({
      pull: () => PULL,
      runs: () => [makeRunSummary()],
      reviews: () => [makeReview({ findings: [kept, dismissed] })],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      pr_id: string;
      pr: number;
      all_runs: boolean;
      reviews: Array<Record<string, unknown>>;
    };
    expect(body.status).toBe('completed');
    expect(body.pr_id).toBe(PULL.id);
    expect(body.pr).toBe(PULL.number);
    expect(body.all_runs).toBe(false);
    expect(body.reviews).toHaveLength(1);

    const entry = body.reviews[0]!;
    expect(entry.run_id).toBe('run-1');
    expect(entry.agent_id).toBe('agent-1');
    expect(entry.verdict).toBe('approve');
    expect(entry.summary).toBe('Looks fine');
    expect(entry.score).toBe(92);
    const findings = entry.findings as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(findings[0]!.title).toBe('Kept');
    // Detailed fields, including id/review_id, so accept/dismiss can be called without a second lookup.
    expect(Object.keys(findings[0]!).sort()).toEqual(
      [
        'category',
        'confidence',
        'end_line',
        'file',
        'id',
        'rationale',
        'review_id',
        'severity',
        'start_line',
        'suggestion',
        'title',
      ].sort(),
    );
  });

  it('two agents, all_runs default (false) -> one entry per agent, the newest run each, sorted newest-first', async () => {
    const fetchMock = createFetch({
      pull: () => PULL,
      runs: () => [
        makeRunSummary({ run_id: 'a1-old', agent_id: 'agent-1', ran_at: '2024-01-01T00:00:00Z' }),
        makeRunSummary({ run_id: 'a1-new', agent_id: 'agent-1', ran_at: '2024-03-01T00:00:00Z' }),
        makeRunSummary({ run_id: 'a2-only', agent_id: 'agent-2', agent_name: 'Style Bot', ran_at: '2024-02-01T00:00:00Z' }),
      ],
      reviews: () => [
        makeReview({ id: 'review-a1-new', run_id: 'a1-new', agent_id: 'agent-1' }),
        makeReview({ id: 'review-a2', run_id: 'a2-only', agent_id: 'agent-2', agent_name: 'Style Bot' }),
      ],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { reviews: Array<Record<string, unknown>> };
    expect(body.reviews).toHaveLength(2);
    expect(body.reviews.map((r) => r.run_id)).toEqual(['a1-new', 'a2-only']);
  });

  it('all_runs: true -> every run per agent is included, not just the newest', async () => {
    const fetchMock = createFetch({
      pull: () => PULL,
      runs: () => [
        makeRunSummary({ run_id: 'a1-old', agent_id: 'agent-1', ran_at: '2024-01-01T00:00:00Z' }),
        makeRunSummary({ run_id: 'a1-new', agent_id: 'agent-1', ran_at: '2024-03-01T00:00:00Z' }),
      ],
      reviews: () => [
        makeReview({ id: 'review-old', run_id: 'a1-old', agent_id: 'agent-1' }),
        makeReview({ id: 'review-new', run_id: 'a1-new', agent_id: 'agent-1' }),
      ],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool(callArgs({ all_runs: true }));

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { all_runs: boolean; reviews: Array<Record<string, unknown>> };
    expect(body.all_runs).toBe(true);
    expect(body.reviews).toHaveLength(2);
    // Newest-first.
    expect(body.reviews.map((r) => r.run_id)).toEqual(['a1-new', 'a1-old']);
  });

  it('a running run carries no findings/verdict yet, and never triggers a GET /pulls/:id/reviews call', async () => {
    const fetchMock = createFetch({
      pull: () => PULL,
      runs: () => [makeRunSummary({ status: 'running' })],
      // `reviews` is deliberately omitted — createFetch throws if it's ever requested.
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { reviews: Array<Record<string, unknown>> };
    expect(body.reviews).toHaveLength(1);
    const entry = body.reviews[0]!;
    expect(entry.status).toBe('running');
    expect(entry.findings).toBeUndefined();
    expect(entry.verdict).toBeUndefined();
  });

  it('a failed run carries its error, a cancelled run carries null error, neither carries findings', async () => {
    const fetchMock = createFetch({
      pull: () => PULL,
      runs: () => [
        makeRunSummary({ run_id: 'run-failed', agent_id: 'agent-1', status: 'failed', error: 'LLM provider returned a 500' }),
        makeRunSummary({ run_id: 'run-cancelled', agent_id: 'agent-2', status: 'cancelled', error: null }),
      ],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { reviews: Array<Record<string, unknown>> };
    const failed = body.reviews.find((r) => r.run_id === 'run-failed')!;
    const cancelled = body.reviews.find((r) => r.run_id === 'run-cancelled')!;
    expect(failed.error).toBe('LLM provider returned a 500');
    expect(failed.findings).toBeUndefined();
    expect(cancelled.error).toBeNull();
  });

  it('a done run with no matching review gets a per-entry error instead of crashing the whole call', async () => {
    const fetchMock = createFetch({
      pull: () => PULL,
      runs: () => [makeRunSummary()],
      reviews: () => [],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { status: string; reviews: Array<Record<string, unknown>> };
    expect(body.status).toBe('completed');
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]!.status).toBe('error');
    expect(body.reviews[0]!.message).toContain('run-1');
  });

  it('is registered with annotations exactly { readOnlyHint: true, destructiveHint: false }', async () => {
    const fetchMock = createFetch({ pull: () => PULL, runs: () => [] });
    harness = await setup(fetchMock);

    const { tools } = await harness.client.listTools();
    const tool = tools.find((t) => t.name === 'devdigest_get_findings');

    expect(tool).toBeDefined();
    expect(tool!.annotations).toEqual({ readOnlyHint: true, destructiveHint: false });
  });
});
