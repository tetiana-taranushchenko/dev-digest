import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient, type FetchLike } from '../src/api/client.js';
import { RunCache } from '../src/runs/run-cache.js';
import {
  failedRunResult,
  pickFindingFields,
  registerRunAgentOnPrTool,
  RUN_RESULT_FINDING_FIELDS,
  stillRunning,
  toRunResultFindings,
  type RunAgentOnPrDeps,
} from '../src/tools/run-agent-on-pr.js';

const BASE_URL = 'http://localhost:3001';

const REPO = { id: 'repo-1', full_name: 'acme/payments-api' };
const PULL = { id: 'pr-1', number: 482 };
const AGENT = {
  id: 'agent-1',
  name: 'Security Reviewer',
  description: 'Flags security issues.',
  enabled: true,
  model: 'claude-sonnet-5',
};
const RUN_TARGET = { run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FetchRoutes {
  repos: () => unknown;
  pulls: () => unknown;
  agents: () => unknown;
  review: () => unknown;
  runs: () => unknown;
  reviews: () => unknown;
}

/** A minimal router over the 6 endpoints this tool touches, dispatched by path suffix + method. */
function createFetch(routes: FetchRoutes): FetchLike {
  return vi.fn<FetchLike>(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (url.endsWith('/repos')) return jsonResponse(200, routes.repos());
    if (method === 'GET' && url.endsWith('/pulls')) return jsonResponse(200, routes.pulls());
    if (url.endsWith('/agents')) return jsonResponse(200, routes.agents());
    if (method === 'POST' && url.endsWith('/review')) return jsonResponse(200, routes.review());
    if (method === 'GET' && url.endsWith('/runs')) return jsonResponse(200, routes.runs());
    if (method === 'GET' && url.endsWith('/reviews')) return jsonResponse(200, routes.reviews());

    throw new Error(`Unhandled request in test fetch mock: ${method} ${url}`);
  });
}

interface Harness {
  client: Client;
  server: McpServer;
  runCache: RunCache;
}

async function setup(
  fetchImpl: FetchLike,
  overrides: Partial<Omit<RunAgentOnPrDeps, 'client'>> = {},
): Promise<Harness> {
  const apiClient = new DevDigestApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
  const runCache = overrides.runCache ?? new RunCache();
  const server = new McpServer({ name: 'devdigest-test', version: '0.0.0' });
  registerRunAgentOnPrTool(server, {
    client: apiClient,
    runCache,
    reviewTimeoutMs: overrides.reviewTimeoutMs ?? 120_000,
    pollIntervalMs: overrides.pollIntervalMs ?? 2_000,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return { client, server, runCache };
}

function parseResultText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const block = result.content[0];
  expect(block?.type).toBe('text');
  return JSON.parse(block!.text!);
}

function callArgs() {
  return { name: 'devdigest_run_agent_on_pr', arguments: { repo: REPO.full_name, pr: PULL.number, agent: AGENT.id } };
}

describe('devdigest_run_agent_on_pr', () => {
  let harness: Harness | undefined;

  afterEach(async () => {
    await harness?.client.close();
    harness = undefined;
    vi.useRealTimers();
  });

  it('happy path: resolve -> POST -> poll -> fetch reviews in one call, findings in the run-result projection', async () => {
    const finding = {
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
      kind: null,
      evidence: null,
    };

    const fetchMock = createFetch({
      repos: () => [REPO],
      pulls: () => [PULL],
      agents: () => [AGENT],
      review: () => ({ pr_id: PULL.id, runs: [RUN_TARGET], reviews: [] }),
      runs: () => [
        { run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer', status: 'done', error: null, ran_at: '2024-01-01T00:00:00Z' },
      ],
      reviews: () => [
        {
          id: 'review-1',
          pr_id: PULL.id,
          agent_id: 'agent-1',
          run_id: 'run-1',
          agent_name: 'Security Reviewer',
          verdict: 'approve',
          summary: 'Looks fine',
          score: 92,
          findings: [finding],
        },
      ],
    });

    harness = await setup(fetchMock);

    // The caller invokes the tool exactly once (REQ-6) — one callTool covers resolve+POST+poll+fetch.
    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as Record<string, unknown>;
    expect(body.status).toBe('completed');
    expect(body.verdict).toBe('approve');
    expect(body.summary).toBe('Looks fine');
    expect(body.score).toBe(92);
    expect(body.run_id).toBe('run-1');
    expect(body.agent_id).toBe('agent-1');
    expect(body.agent_name).toBe('Security Reviewer');
    expect(body.repo).toBe(REPO.full_name);
    expect(body.pr).toBe(PULL.number);

    const findings = body.findings as Array<Record<string, unknown>>;
    expect(findings).toHaveLength(1);
    expect(Object.keys(findings[0]!).sort()).toEqual(
      ['category', 'confidence', 'end_line', 'file', 'rationale', 'severity', 'start_line', 'suggestion', 'title'].sort(),
    );
  });

  it('timeout: still_running past reviewTimeoutMs, never cancels, cache written before polling began', async () => {
    vi.useFakeTimers();

    const reviewTimeoutMs = 120_000;
    const pollIntervalMs = 2_000;
    const runCache = new RunCache();
    let cacheWasPopulatedBeforeFirstPoll: boolean | undefined;

    const fetchMock = createFetch({
      repos: () => [REPO],
      pulls: () => [PULL],
      agents: () => [AGENT],
      review: () => ({ pr_id: PULL.id, runs: [RUN_TARGET], reviews: [] }),
      runs: () => {
        if (cacheWasPopulatedBeforeFirstPoll === undefined) {
          cacheWasPopulatedBeforeFirstPoll = runCache.lookup('run-1') !== undefined;
        }
        return [
          { run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer', status: 'running', error: null, ran_at: '2024-01-01T00:00:00Z' },
        ];
      },
      reviews: () => [],
    });

    harness = await setup(fetchMock, { runCache, reviewTimeoutMs, pollIntervalMs });

    // Client-side request timeout must exceed the fake-time budget we're about to advance through.
    const resultPromise = harness.client.callTool(callArgs(), undefined, {
      timeout: reviewTimeoutMs + 60_000,
    });

    await vi.advanceTimersByTimeAsync(reviewTimeoutMs + pollIntervalMs);
    const result = await resultPromise;

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { status: string; run_id: string; message: string };
    expect(body.status).toBe('still_running');
    expect(body.run_id).toBe('run-1');
    expect(body.message).toContain('devdigest_get_findings');
    expect(body.message).toContain('run-1');

    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(calledUrls.some((url) => url.toLowerCase().includes('cancel'))).toBe(false);
    expect(cacheWasPopulatedBeforeFirstPoll).toBe(true);
  });

  it('never polls GET /pulls/:id/runs more often than once per pollIntervalMs', async () => {
    vi.useFakeTimers();

    const pollIntervalMs = 2_000;
    const pollTimestamps: number[] = [];
    let callCount = 0;

    const fetchMock = createFetch({
      repos: () => [REPO],
      pulls: () => [PULL],
      agents: () => [AGENT],
      review: () => ({ pr_id: PULL.id, runs: [RUN_TARGET], reviews: [] }),
      runs: () => {
        pollTimestamps.push(Date.now());
        callCount += 1;
        const status = callCount >= 3 ? 'done' : 'running';
        return [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer', status, error: null, ran_at: '2024-01-01T00:00:00Z' }];
      },
      reviews: () => [
        { id: 'review-1', pr_id: PULL.id, agent_id: 'agent-1', run_id: 'run-1', agent_name: 'Security Reviewer', verdict: 'approve', summary: 'ok', score: 80, findings: [] },
      ],
    });

    harness = await setup(fetchMock, { reviewTimeoutMs: 60_000, pollIntervalMs });

    const resultPromise = harness.client.callTool(callArgs(), undefined, { timeout: 120_000 });
    await vi.advanceTimersByTimeAsync(pollIntervalMs * 3);
    const result = await resultPromise;

    expect(result.isError).toBeFalsy();
    expect(pollTimestamps.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < pollTimestamps.length; i += 1) {
      expect(pollTimestamps[i]! - pollTimestamps[i - 1]!).toBeGreaterThanOrEqual(pollIntervalMs);
    }
  });

  it('failed run: surfaces RunSummary.error plus a next step, isError: false', async () => {
    const fetchMock = createFetch({
      repos: () => [REPO],
      pulls: () => [PULL],
      agents: () => [AGENT],
      review: () => ({ pr_id: PULL.id, runs: [RUN_TARGET], reviews: [] }),
      runs: () => [
        { run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer', status: 'failed', error: 'LLM provider returned a 500', ran_at: '2024-01-01T00:00:00Z' },
      ],
      reviews: () => [],
    });

    harness = await setup(fetchMock);
    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      run_id: string;
      error: string | null;
      next_step: string;
    };
    expect(body.status).toBe('failed');
    expect(body.run_id).toBe('run-1');
    expect(body.error).toBe('LLM provider returned a 500');
    expect(body.next_step.length).toBeGreaterThan(0);
  });

  it('trims findings to exactly the 9 run-result keys and excludes dismissed findings', async () => {
    const keptFinding = {
      id: 'f1',
      review_id: 'review-1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'SQL injection',
      file: 'src/db.ts',
      start_line: 5,
      end_line: 9,
      rationale: 'Untrusted input is concatenated into a query.',
      suggestion: 'Use a parameterized query.',
      confidence: 0.95,
      accepted_at: null,
      dismissed_at: null,
      kind: null,
      evidence: null,
    };
    const dismissedFinding = {
      id: 'f2',
      review_id: 'review-1',
      severity: 'WARNING',
      category: 'style',
      title: 'Should be dropped',
      file: 'src/y.ts',
      start_line: 1,
      end_line: 1,
      rationale: 'n/a',
      suggestion: null,
      confidence: 0.5,
      accepted_at: null,
      dismissed_at: '2024-02-01T00:00:00Z',
      kind: null,
      evidence: null,
    };

    const fetchMock = createFetch({
      repos: () => [REPO],
      pulls: () => [PULL],
      agents: () => [AGENT],
      review: () => ({ pr_id: PULL.id, runs: [RUN_TARGET], reviews: [] }),
      runs: () => [
        { run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Security Reviewer', status: 'done', error: null, ran_at: '2024-01-01T00:00:00Z' },
      ],
      reviews: () => [
        {
          id: 'review-1',
          pr_id: PULL.id,
          agent_id: 'agent-1',
          run_id: 'run-1',
          agent_name: 'Security Reviewer',
          verdict: 'block',
          summary: 'Blocking issue found',
          score: 40,
          findings: [keptFinding, dismissedFinding],
        },
      ],
    });

    harness = await setup(fetchMock);
    const result = await harness.client.callTool(callArgs());

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { findings: Array<Record<string, unknown>> };
    expect(body.findings).toHaveLength(1);
    const only = body.findings[0]!;
    expect(Object.keys(only).sort()).toEqual(
      ['category', 'confidence', 'end_line', 'file', 'rationale', 'severity', 'start_line', 'suggestion', 'title'].sort(),
    );
    expect(only).toEqual({
      severity: 'CRITICAL',
      category: 'security',
      title: 'SQL injection',
      file: 'src/db.ts',
      start_line: 5,
      end_line: 9,
      rationale: 'Untrusted input is concatenated into a query.',
      suggestion: 'Use a parameterized query.',
      confidence: 0.95,
    });
  });

  it('is registered with annotations exactly { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }', async () => {
    const fetchMock = createFetch({
      repos: () => [],
      pulls: () => [],
      agents: () => [],
      review: () => ({ pr_id: PULL.id, runs: [], reviews: [] }),
      runs: () => [],
      reviews: () => [],
    });
    harness = await setup(fetchMock);

    const { tools } = await harness.client.listTools();
    const tool = tools.find((t) => t.name === 'devdigest_run_agent_on_pr');

    expect(tool).toBeDefined();
    expect(tool!.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });
});

describe('exported helpers (reused by T9)', () => {
  it('stillRunning() names devdigest_get_findings and the literal run_id', () => {
    const result = stillRunning('run-xyz');
    expect(result).toEqual({
      status: 'still_running',
      run_id: 'run-xyz',
      message: expect.stringContaining('devdigest_get_findings'),
    });
    expect(result.message).toContain('run-xyz');
  });

  it('failedRunResult() surfaces the error and a next step for both failed and cancelled', () => {
    const failed = failedRunResult({ run_id: 'run-1', status: 'failed', error: 'boom' });
    expect(failed).toEqual({
      status: 'failed',
      run_id: 'run-1',
      error: 'boom',
      next_step: expect.stringContaining('devdigest_run_agent_on_pr'),
    });

    const cancelled = failedRunResult({ run_id: 'run-2', status: 'cancelled', error: null });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toBeNull();
    expect(cancelled.next_step.length).toBeGreaterThan(0);
  });

  it('pickFindingFields()/toRunResultFindings() trim to exactly RUN_RESULT_FINDING_FIELDS and drop dismissed findings', () => {
    const finding = {
      id: 'f1',
      review_id: 'review-1',
      severity: 'CRITICAL',
      category: 'security',
      title: 'x',
      file: 'a.ts',
      start_line: 1,
      end_line: 2,
      rationale: 'r',
      suggestion: 's',
      confidence: 0.5,
      accepted_at: null,
      dismissed_at: null,
    } as never;

    const trimmed = pickFindingFields(finding, RUN_RESULT_FINDING_FIELDS);
    expect(Object.keys(trimmed).sort()).toEqual([...RUN_RESULT_FINDING_FIELDS].sort());

    const dismissed = { ...finding, id: 'f2', dismissed_at: '2024-01-01T00:00:00Z' } as never;
    expect(toRunResultFindings([finding, dismissed])).toHaveLength(1);
  });
});
