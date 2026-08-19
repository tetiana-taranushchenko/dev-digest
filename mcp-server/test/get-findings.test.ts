import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient, type FetchLike } from '../src/api/client.js';
import * as resolveModule from '../src/api/resolve.js';
import { RunCache, type CachedRun } from '../src/runs/run-cache.js';
import { registerGetFindingsTool } from '../src/tools/get-findings.js';
import {
  CONCISE_FINDING_FIELDS,
  DETAILED_FINDING_FIELDS,
  failedRunResult,
  stillRunning,
} from '../src/tools/run-agent-on-pr.js';

vi.mock('../src/api/resolve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/resolve.js')>();
  return {
    ...actual,
    resolveRepo: vi.fn(actual.resolveRepo),
    resolvePull: vi.fn(actual.resolvePull),
  };
});

const BASE_URL = 'http://localhost:3001';

const REPO = { id: 'repo-1', full_name: 'acme/payments-api' };
const PULL = { id: 'pr-1', number: 482 };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FetchRoutes {
  repos?: () => unknown;
  pulls?: () => unknown;
  runs?: () => unknown;
  reviews?: () => unknown;
}

/** A minimal router over the 4 endpoints devdigest_get_findings can touch, dispatched by path suffix + method. */
function createFetch(routes: FetchRoutes): FetchLike {
  return vi.fn<FetchLike>(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();

    if (method === 'GET' && url.endsWith('/repos') && routes.repos) return jsonResponse(200, routes.repos());
    if (method === 'GET' && url.endsWith('/pulls') && routes.pulls) return jsonResponse(200, routes.pulls());
    if (method === 'GET' && url.endsWith('/runs') && routes.runs) return jsonResponse(200, routes.runs());
    if (method === 'GET' && url.endsWith('/reviews') && routes.reviews) return jsonResponse(200, routes.reviews());

    throw new Error(`Unhandled/unexpected request in test fetch mock: ${method} ${url}`);
  });
}

/** A fetch mock that fails the test if it is ever invoked — for the argument-guard cases, which must short-circuit before any HTTP call. */
function noFetch(): FetchLike {
  return vi.fn<FetchLike>(async (input) => {
    throw new Error(`No HTTP call was expected, but one was made: ${String(input)}`);
  });
}

interface Harness {
  client: Client;
  server: McpServer;
  runCache: RunCache;
}

async function setup(fetchImpl: FetchLike, runCache: RunCache = new RunCache()): Promise<Harness> {
  const apiClient = new DevDigestApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
  const server = new McpServer({ name: 'devdigest-test', version: '0.0.0' });
  registerGetFindingsTool(server, { client: apiClient, runCache });

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

function makeCachedRun(overrides: Partial<CachedRun> = {}): CachedRun {
  return {
    repoId: REPO.id,
    prId: PULL.id,
    prNumber: PULL.number,
    repoFullName: REPO.full_name,
    agentId: 'agent-1',
    agentName: 'Security Reviewer',
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
    vi.clearAllMocks();
  });

  // (a) all four bad argument-combination cases.
  describe('argument guard (a)', () => {
    const cases: Array<{ label: string; args: Record<string, unknown> }> = [
      { label: 'both run_id and repo+pr given', args: { run_id: 'run-1', repo: REPO.full_name, pr: PULL.number } },
      { label: 'neither run_id nor repo+pr given', args: {} },
      { label: 'repo without pr', args: { repo: REPO.full_name } },
      { label: 'pr without repo', args: { pr: PULL.number } },
    ];

    for (const { label, args } of cases) {
      it(`rejects ${label} with an actionable message naming both call shapes, and makes no HTTP call`, async () => {
        harness = await setup(noFetch());

        const result = await harness.client.callTool({ name: 'devdigest_get_findings', arguments: args });

        expect(result.isError).toBe(true);
        const body = parseResultText(result as never) as { message: string };
        expect(body.message).toMatch(/run_id/);
        expect(body.message).toMatch(/repo/);
        expect(body.message).toMatch(/pr/);
      });
    }
  });

  // (b) run_id path: hit / miss / running / failed.
  describe('run_id path (b)', () => {
    it('cache hit, status done -> returns the verdict + trimmed findings', async () => {
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());

      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'done' })],
        reviews: () => [makeReview()],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1' },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never) as Record<string, unknown>;
      expect(body.status).toBe('completed');
      expect(body.verdict).toBe('approve');
      expect(body.run_id).toBe('run-1');
      expect(body.repo).toBe(REPO.full_name);
      expect(body.pr).toBe(PULL.number);
      expect(body.findings).toHaveLength(1);
    });

    it('cache miss -> actionable message naming BOTH fixes, leading with "call again with repo and pr" then re-running devdigest_run_agent_on_pr; not a silent empty result', async () => {
      harness = await setup(noFetch());

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'unknown-run' },
      });

      expect(result.isError).toBe(true);
      const body = parseResultText(result as never) as { status: string; message: string };
      expect(body.status).toBe('error');
      expect(body.message).toMatch(/not found in this session/i);
      expect(body.message).toMatch(/repo/);
      expect(body.message).toMatch(/pr/);
      expect(body.message).toMatch(/devdigest_run_agent_on_pr/);

      // "call again with repo+pr" must come BEFORE "re-run devdigest_run_agent_on_pr" (REQ-8 order).
      const repoPrIndex = body.message.indexOf('repo and pr');
      const rerunIndex = body.message.indexOf('devdigest_run_agent_on_pr');
      expect(repoPrIndex).toBeGreaterThan(-1);
      expect(rerunIndex).toBeGreaterThan(-1);
      expect(repoPrIndex).toBeLessThan(rerunIndex);

      expect(body).not.toEqual({});
      expect('findings' in body).toBe(false);
    });

    it('cached run_id still running -> status: still_running', async () => {
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());

      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'running' })],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1' },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never);
      expect(body).toEqual(stillRunning('run-1'));
    });

    it('cached run_id failed -> surfaces the server error', async () => {
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());

      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'failed', error: 'LLM provider returned a 500' })],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1' },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never);
      expect(body).toEqual(
        failedRunResult({ run_id: 'run-1', status: 'failed', error: 'LLM provider returned a 500' }),
      );
    });
  });

  // (c) repo+pr path happy case, proving newest-run selection via an out-of-order fixture.
  it('(c) repo+pr happy path: resolves via T4 resolver, picks the newest-ran_at run out of an out-of-order fixture, fetches the matching review', async () => {
    const fetchMock = createFetch({
      repos: () => [REPO],
      pulls: () => [PULL],
      // Deliberately out of order: the newest run ("run-newest") is neither
      // first nor last, so neither a naive "take first" nor "take last"
      // implementation would pick it correctly — only a proper sort by
      // `ran_at` does.
      runs: () => [
        makeRunSummary({ run_id: 'run-middle', ran_at: '2024-03-01T00:00:00Z', status: 'done' }),
        makeRunSummary({ run_id: 'run-newest', ran_at: '2024-06-01T00:00:00Z', status: 'done' }),
        makeRunSummary({ run_id: 'run-oldest', ran_at: '2024-01-01T00:00:00Z', status: 'done' }),
      ],
      reviews: () => [
        makeReview({ id: 'review-oldest', run_id: 'run-oldest', verdict: 'block', summary: 'wrong one' }),
        makeReview({ id: 'review-newest', run_id: 'run-newest', verdict: 'approve', summary: 'right one' }),
        makeReview({ id: 'review-middle', run_id: 'run-middle', verdict: 'block', summary: 'also wrong' }),
      ],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool({
      name: 'devdigest_get_findings',
      arguments: { repo: REPO.full_name, pr: PULL.number },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as Record<string, unknown>;
    expect(body.run_id).toBe('run-newest');
    expect(body.verdict).toBe('approve');
    expect(body.summary).toBe('right one');

    expect(resolveModule.resolveRepo).toHaveBeenCalledTimes(1);
    expect(resolveModule.resolveRepo).toHaveBeenCalledWith(expect.anything(), REPO.full_name);
    expect(resolveModule.resolvePull).toHaveBeenCalledTimes(1);
    expect(resolveModule.resolvePull).toHaveBeenCalledWith(expect.anything(), REPO.id, PULL.number);
  });

  // (d) repo+pr running -> same shape as T8's stillRunning builder, key-for-key.
  it('(d) repo+pr, most recent run running -> the exact same object shape T8 builds for its own timeout, asserted key-for-key', async () => {
    const fetchMock = createFetch({
      repos: () => [REPO],
      pulls: () => [PULL],
      runs: () => [makeRunSummary({ run_id: 'run-1', status: 'running' })],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool({
      name: 'devdigest_get_findings',
      arguments: { repo: REPO.full_name, pr: PULL.number },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as Record<string, unknown>;
    const expected = stillRunning('run-1');

    expect(Object.keys(body).sort()).toEqual(Object.keys(expected).sort());
    expect(body).toEqual(expected);
  });

  // (e) repo+pr failed/cancelled -> same {status, run_id, error, next_step} shape as the run_id path.
  describe('(e) repo+pr, most recent run failed/cancelled', () => {
    it('failed -> same shape as failedRunResult()', async () => {
      const fetchMock = createFetch({
        repos: () => [REPO],
        pulls: () => [PULL],
        runs: () => [makeRunSummary({ run_id: 'run-1', status: 'failed', error: 'boom' })],
      });
      harness = await setup(fetchMock);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { repo: REPO.full_name, pr: PULL.number },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never);
      expect(body).toEqual(failedRunResult({ run_id: 'run-1', status: 'failed', error: 'boom' }));
    });

    it('cancelled -> same shape as failedRunResult()', async () => {
      const fetchMock = createFetch({
        repos: () => [REPO],
        pulls: () => [PULL],
        runs: () => [makeRunSummary({ run_id: 'run-1', status: 'cancelled', error: null })],
      });
      harness = await setup(fetchMock);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { repo: REPO.full_name, pr: PULL.number },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never);
      expect(body).toEqual(failedRunResult({ run_id: 'run-1', status: 'cancelled', error: null }));
    });
  });

  // (f) repo+pr with zero runs -> actionable message, not an empty array.
  it('(f) repo+pr, PR has no runs at all -> actionable message naming devdigest_run_agent_on_pr, not a bare empty result', async () => {
    const fetchMock = createFetch({
      repos: () => [REPO],
      pulls: () => [PULL],
      runs: () => [],
    });
    harness = await setup(fetchMock);

    const result = await harness.client.callTool({
      name: 'devdigest_get_findings',
      arguments: { repo: REPO.full_name, pr: PULL.number },
    });

    expect(result.isError).toBe(true);
    const body = parseResultText(result as never) as { message: string; findings?: unknown };
    expect(body.message).toMatch(/devdigest_run_agent_on_pr/);
    expect(body.findings).toBeUndefined();
  });

  // (g) response_format exact key-set assertions for both concise and detailed.
  describe('(g) response_format exact key sets', () => {
    it('default/concise result keys equal exactly CONCISE_FINDING_FIELDS', async () => {
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());
      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'done' })],
        reviews: () => [makeReview()],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1' },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never) as {
        response_format: string;
        findings: Array<Record<string, unknown>>;
      };
      expect(body.response_format).toBe('concise');
      expect(Object.keys(body.findings[0]!).sort()).toEqual([...CONCISE_FINDING_FIELDS].sort());
      expect([...CONCISE_FINDING_FIELDS].sort()).toEqual(
        Object.keys(body.findings[0]!).sort(),
      );
    });

    it("response_format:'detailed' result keys equal exactly DETAILED_FINDING_FIELDS", async () => {
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());
      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'done' })],
        reviews: () => [makeReview()],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1', response_format: 'detailed' },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never) as {
        response_format: string;
        findings: Array<Record<string, unknown>>;
      };
      expect(body.response_format).toBe('detailed');
      expect(Object.keys(body.findings[0]!).sort()).toEqual([...DETAILED_FINDING_FIELDS].sort());
      expect([...DETAILED_FINDING_FIELDS].sort()).toEqual(
        Object.keys(body.findings[0]!).sort(),
      );
    });
  });

  // (h) pagination slicing + has_more/total, including a no-params default-to-25 case.
  describe('(h) pagination', () => {
    it('offset=2, limit=2 on a 6-finding fixture returns findings 3-4 with has_more:true, total:6', async () => {
      const findings = Array.from({ length: 6 }, (_, i) => makeFinding({ id: `f${i + 1}`, title: `Finding ${i + 1}` }));
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());
      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'done' })],
        reviews: () => [makeReview({ findings })],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1', offset: 2, limit: 2 },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never) as {
        total: number;
        returned: number;
        offset: number;
        limit: number;
        has_more: boolean;
        findings: Array<Record<string, unknown>>;
        next_step?: string;
      };
      expect(body.total).toBe(6);
      expect(body.returned).toBe(2);
      expect(body.offset).toBe(2);
      expect(body.limit).toBe(2);
      expect(body.has_more).toBe(true);
      expect(body.findings.map((f) => f.title)).toEqual(['Finding 3', 'Finding 4']);
      expect(body.next_step).toBeDefined();
    });

    it('no offset/limit given -> defaults to offset 0, limit 25; has_more:true on a 40-finding fixture', async () => {
      const findings = Array.from({ length: 40 }, (_, i) => makeFinding({ id: `f${i + 1}`, title: `Finding ${i + 1}` }));
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());
      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'done' })],
        reviews: () => [makeReview({ findings })],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1' },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never) as {
        total: number;
        returned: number;
        offset: number;
        limit: number;
        has_more: boolean;
        findings: unknown[];
      };
      expect(body.total).toBe(40);
      expect(body.offset).toBe(0);
      expect(body.limit).toBe(25);
      expect(body.returned).toBe(25);
      expect(body.findings).toHaveLength(25);
      expect(body.has_more).toBe(true);
    });
  });

  // (i) dismissed-finding filtering excluded from total in both response_format modes.
  describe('(i) dismissed-finding filtering', () => {
    it('a dismissed finding is absent and excluded from total in concise mode', async () => {
      const findings = [
        makeFinding({ id: 'f1', title: 'Kept' }),
        makeFinding({ id: 'f2', title: 'Dropped', dismissed_at: '2024-02-01T00:00:00Z' }),
      ];
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());
      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'done' })],
        reviews: () => [makeReview({ findings })],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1' },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never) as { total: number; findings: Array<Record<string, unknown>> };
      expect(body.total).toBe(1);
      expect(body.findings).toHaveLength(1);
      expect(body.findings[0]!.title).toBe('Kept');
    });

    it('a dismissed finding is absent and excluded from total in detailed mode', async () => {
      const findings = [
        makeFinding({ id: 'f1', title: 'Kept' }),
        makeFinding({ id: 'f2', title: 'Dropped', dismissed_at: '2024-02-01T00:00:00Z' }),
      ];
      const runCache = new RunCache();
      runCache.remember('run-1', makeCachedRun());
      const fetchMock = createFetch({
        runs: () => [makeRunSummary({ status: 'done' })],
        reviews: () => [makeReview({ findings })],
      });
      harness = await setup(fetchMock, runCache);

      const result = await harness.client.callTool({
        name: 'devdigest_get_findings',
        arguments: { run_id: 'run-1', response_format: 'detailed' },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResultText(result as never) as { total: number; findings: Array<Record<string, unknown>> };
      expect(body.total).toBe(1);
      expect(body.findings).toHaveLength(1);
      expect(body.findings[0]!.title).toBe('Kept');
    });
  });
});
