// Integration lane (T13, REQ-15) — `.it.test.ts` suffix so `test:unit`'s
// `--exclude "**/*.it.test.ts"` skips it and `test:it`'s `vitest run
// .it.test.ts` picks it up (see package.json scripts).
//
// Unlike every other test file in this package, this one does NOT inject a
// fake `fetch`. It boots a real `node:http` stub of the DevDigest API on an
// ephemeral port (no Docker, no Postgres, no running studio) and drives the
// real MCP protocol — `client.callTool(...)` over
// `InMemoryTransport.createLinkedPair()` — against `createMcpServer` wired to
// a `DevDigestApiClient` pointed at that stub's actual bound port. This is
// the one lane that proves the whole wire-up (schema -> tool handler -> HTTP
// client -> real HTTP server -> response parsing -> MCP result) actually
// works end to end, not just each piece in isolation with a mock.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevDigestApiClient } from '../src/api/client.js';
import { RunCache } from '../src/runs/run-cache.js';
import { createMcpServer } from '../src/server.js';
import { DETAILED_FINDING_FIELDS } from '../src/tools/run-agent-on-pr.js';

const EXPECTED_TOOL_NAMES = [
  'devdigest_list_agents',
  'devdigest_run_agent_on_pr',
  'devdigest_get_findings',
  'devdigest_get_conventions',
  'devdigest_get_blast_radius',
] as const;

const REPO = { id: 'repo-1', full_name: 'acme/payments-api' };
const PULL = { id: 'pr-1', number: 482 };
const AGENT = {
  id: 'agent-1',
  name: 'Security Reviewer',
  description: 'Flags security issues in a pull request.',
  enabled: true,
  model: 'claude-sonnet-5',
};
const RUN_TARGET = { run_id: 'run-1', agent_id: AGENT.id, agent_name: AGENT.name };
const FINDING = {
  id: 'finding-1',
  review_id: 'review-1',
  severity: 'WARNING',
  category: 'security',
  title: 'Potential SQL injection',
  file: 'src/db.ts',
  start_line: 12,
  end_line: 18,
  rationale: 'User input is concatenated directly into the query string.',
  suggestion: 'Use a parameterized query instead of string concatenation.',
  confidence: 0.87,
  accepted_at: null as string | null,
  dismissed_at: null as string | null,
};
const REVIEW = {
  id: 'review-1',
  pr_id: PULL.id,
  agent_id: AGENT.id,
  run_id: RUN_TARGET.run_id,
  agent_name: AGENT.name,
  verdict: 'request_changes',
  summary: 'Found a security issue that should be addressed before merge.',
  score: 62,
  findings: [FINDING],
};

// A second PR under the same repo that the stub reports as having zero runs
// at all (T13 item 4) — exercises devdigest_get_findings' repo+pr "run a
// review first" actionable message.
const PULL_NO_RUNS = { id: 'pr-no-runs', number: 999 };

// A third PR under the same repo whose single (already-`done`) run has a
// 5-finding review, so offset/limit slicing (T13 item 3) has something
// meaningful to slice. It is looked up directly via repo+pr — no run_id is
// ever cached for it.
const PULL_PAGINATED = { id: 'pr-paginated', number: 555 };
const RUN_PAGINATED = { run_id: 'run-paginated', agent_id: AGENT.id, agent_name: AGENT.name };
const PAGINATED_FINDINGS = Array.from({ length: 5 }, (_, i) => ({
  id: `finding-p${i + 1}`,
  review_id: 'review-paginated',
  severity: 'INFO',
  category: 'style',
  title: `Finding ${i + 1}`,
  file: 'src/x.ts',
  start_line: i + 1,
  end_line: i + 1,
  rationale: `Rationale for finding ${i + 1}.`,
  suggestion: `Suggestion for finding ${i + 1}.`,
  confidence: 0.5,
  accepted_at: null as string | null,
  dismissed_at: null as string | null,
}));
const REVIEW_PAGINATED = {
  id: 'review-paginated',
  pr_id: PULL_PAGINATED.id,
  agent_id: AGENT.id,
  run_id: RUN_PAGINATED.run_id,
  agent_name: AGENT.name,
  verdict: 'comment',
  summary: 'Several style findings.',
  score: 80,
  findings: PAGINATED_FINDINGS,
};

/**
 * A minimal, real `node:http` server implementing exactly the endpoints
 * `mcp-server`'s API client calls (`GET /repos`, `GET /repos/:id/pulls`,
 * `GET /agents`, `POST /pulls/:id/review`, `GET /pulls/:id/runs`,
 * `GET /pulls/:id/reviews`, `GET /repos/:id/conventions`, `GET /health`).
 * `GET /pulls/:id/runs` reports `status: 'running'` for its first two calls,
 * then `'done'` afterwards, so the tool's real poll loop is genuinely
 * exercised over real (not fake) time, not just a single status check.
 *
 * Two extra PRs (T13) round out `devdigest_get_findings`' repo+pr path:
 * `PULL_NO_RUNS` always reports zero runs (the "run a review first" path),
 * and `PULL_PAGINATED` has a single already-`done` run whose review carries
 * 5 findings (the offset/limit slicing path).
 */
function createApiStub(): { server: Server; baseUrl: string; getRequestCount: () => number } {
  let requestCount = 0;
  let runsPollCount = 0;

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(text);
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requestCount += 1;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && path === '/health') {
      sendJson(res, 200, { status: 'ok' });
      return;
    }
    if (method === 'GET' && path === '/repos') {
      sendJson(res, 200, [REPO]);
      return;
    }
    if (method === 'GET' && path === `/repos/${REPO.id}/pulls`) {
      sendJson(res, 200, [PULL, PULL_NO_RUNS, PULL_PAGINATED]);
      return;
    }
    if (method === 'GET' && path === `/repos/${REPO.id}/conventions`) {
      sendJson(res, 200, []);
      return;
    }
    if (method === 'GET' && path === '/agents') {
      sendJson(res, 200, [AGENT]);
      return;
    }
    if (method === 'POST' && path === `/pulls/${PULL.id}/review`) {
      sendJson(res, 200, { pr_id: PULL.id, runs: [RUN_TARGET], reviews: [] });
      return;
    }
    if (method === 'GET' && path === `/pulls/${PULL.id}/runs`) {
      runsPollCount += 1;
      const status = runsPollCount <= 2 ? 'running' : 'done';
      sendJson(res, 200, [
        {
          run_id: RUN_TARGET.run_id,
          agent_id: AGENT.id,
          agent_name: AGENT.name,
          status,
          error: null,
          ran_at: new Date().toISOString(),
        },
      ]);
      return;
    }
    if (method === 'GET' && path === `/pulls/${PULL.id}/reviews`) {
      sendJson(res, 200, [REVIEW]);
      return;
    }
    if (method === 'GET' && path === `/pulls/${PULL_NO_RUNS.id}/runs`) {
      sendJson(res, 200, []);
      return;
    }
    if (method === 'GET' && path === `/pulls/${PULL_PAGINATED.id}/runs`) {
      sendJson(res, 200, [
        {
          run_id: RUN_PAGINATED.run_id,
          agent_id: RUN_PAGINATED.agent_id,
          agent_name: RUN_PAGINATED.agent_name,
          status: 'done',
          error: null,
          ran_at: new Date().toISOString(),
        },
      ]);
      return;
    }
    if (method === 'GET' && path === `/pulls/${PULL_PAGINATED.id}/reviews`) {
      sendJson(res, 200, [REVIEW_PAGINATED]);
      return;
    }

    sendJson(res, 404, {
      error: { code: 'not_found', message: `no stub route for ${method} ${path}` },
    });
  });

  return {
    server,
    // baseUrl is filled in by startApiStub() once the port is bound.
    baseUrl: '',
    getRequestCount: () => requestCount,
  };
}

async function startApiStub(): Promise<{
  server: Server;
  baseUrl: string;
  getRequestCount: () => number;
}> {
  const stub = createApiStub();
  await new Promise<void>((resolve) => stub.server.listen(0, '127.0.0.1', resolve));
  const address = stub.server.address() as AddressInfo;
  return { ...stub, baseUrl: `http://127.0.0.1:${address.port}` };
}

function parseResultText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const block = result.content[0];
  expect(block?.type).toBe('text');
  return JSON.parse(block!.text!);
}

describe('mcp-server integration (real HTTP stub + real MCP protocol)', () => {
  let stub: Awaited<ReturnType<typeof startApiStub>>;
  let client: Client;
  let server: McpServer;
  let capturedRunId: string;

  beforeAll(async () => {
    stub = await startApiStub();

    const apiClient = new DevDigestApiClient({ baseUrl: stub.baseUrl, fetch });
    server = createMcpServer({
      client: apiClient,
      runCache: new RunCache(),
      // Real (not fake) time: short poll interval + a short-ish timeout so
      // this test doesn't take anywhere near the ~2 min default budget,
      // while comfortably outlasting the stub's 2-poll "running" window.
      pollIntervalMs: 80,
      reviewTimeoutMs: 5_000,
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'it-test-client', version: '0.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterAll(async () => {
    await client?.close();
    await new Promise<void>((resolve, reject) => {
      stub.server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('advertises exactly the 5 namespaced tools over the real MCP protocol', async () => {
    const { tools } = await client.listTools();
    expect(new Set(tools.map((tool) => tool.name))).toEqual(new Set(EXPECTED_TOOL_NAMES));
  });

  it('devdigest_list_agents returns the trimmed list from the stub fixture', async () => {
    const result = await client.callTool({ name: 'devdigest_list_agents', arguments: {} });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as { agents: Array<Record<string, unknown>> };
    expect(body.agents).toEqual([
      {
        id: AGENT.id,
        name: AGENT.name,
        description: AGENT.description,
        enabled: AGENT.enabled,
        model: AGENT.model,
      },
    ]);
  });

  it('devdigest_run_agent_on_pr walks resolve -> POST -> poll (running x2 -> done) -> reviews against the real stub', async () => {
    const result = await client.callTool({
      name: 'devdigest_run_agent_on_pr',
      arguments: { repo: REPO.full_name, pr: PULL.number, agent: AGENT.id },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      verdict: string;
      run_id: string;
      repo: string;
      pr: number;
      findings: Array<Record<string, unknown>>;
    };

    expect(body.status).toBe('completed');
    expect(body.verdict).toBe(REVIEW.verdict);
    expect(body.repo).toBe(REPO.full_name);
    expect(body.pr).toBe(PULL.number);
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toMatchObject({
      severity: FINDING.severity,
      category: FINDING.category,
      title: FINDING.title,
      file: FINDING.file,
      rationale: FINDING.rationale,
    });
    // Findings arrive already grounded from the (stub) server — the run
    // result carries the review's grounded finding data, not a re-derivation.

    capturedRunId = body.run_id;
    expect(capturedRunId).toBe(RUN_TARGET.run_id);
  });

  it('devdigest_get_findings with the captured run_id returns the same verdict and findings', async () => {
    expect(capturedRunId).toBeDefined();

    const result = await client.callTool({
      name: 'devdigest_get_findings',
      arguments: { run_id: capturedRunId },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      verdict: string;
      run_id: string;
      findings: Array<Record<string, unknown>>;
    };

    expect(body.status).toBe('completed');
    expect(body.verdict).toBe(REVIEW.verdict);
    expect(body.run_id).toBe(capturedRunId);
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toMatchObject({
      severity: FINDING.severity,
      category: FINDING.category,
      title: FINDING.title,
    });
  });

  it('devdigest_get_findings with repo+pr (no run_id) returns the same review via the most-recent-run path', async () => {
    const result = await client.callTool({
      name: 'devdigest_get_findings',
      arguments: { repo: REPO.full_name, pr: PULL.number },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      status: string;
      verdict: string;
      run_id: string;
      repo: string;
      pr: number;
      findings: Array<Record<string, unknown>>;
    };

    expect(body.status).toBe('completed');
    expect(body.verdict).toBe(REVIEW.verdict);
    expect(body.run_id).toBe(RUN_TARGET.run_id);
    expect(body.repo).toBe(REPO.full_name);
    expect(body.pr).toBe(PULL.number);
    expect(body.findings).toHaveLength(1);
    expect(body.findings[0]).toMatchObject({
      severity: FINDING.severity,
      category: FINDING.category,
      title: FINDING.title,
    });
  });

  it("devdigest_get_findings with response_format: 'detailed' returns findings with exactly the 11 detailed keys", async () => {
    const result = await client.callTool({
      name: 'devdigest_get_findings',
      arguments: { run_id: capturedRunId, response_format: 'detailed' },
    });

    expect(result.isError).toBeFalsy();
    const body = parseResultText(result as never) as {
      response_format: string;
      findings: Array<Record<string, unknown>>;
    };

    expect(body.response_format).toBe('detailed');
    expect(body.findings).toHaveLength(1);
    expect(Object.keys(body.findings[0]!).sort()).toEqual([...DETAILED_FINDING_FIELDS].sort());
  });

  it('devdigest_get_findings with offset/limit returns the correctly sliced page', async () => {
    const result = await client.callTool({
      name: 'devdigest_get_findings',
      arguments: { repo: REPO.full_name, pr: PULL_PAGINATED.number, offset: 2, limit: 2 },
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

    expect(body.total).toBe(5);
    expect(body.returned).toBe(2);
    expect(body.offset).toBe(2);
    expect(body.limit).toBe(2);
    expect(body.has_more).toBe(true);
    expect(body.findings.map((f) => f.title)).toEqual(['Finding 3', 'Finding 4']);
    expect(body.next_step).toBeDefined();
  });

  it('devdigest_get_findings for a PR with no runs at all returns the "run a review first" actionable message', async () => {
    const result = await client.callTool({
      name: 'devdigest_get_findings',
      arguments: { repo: REPO.full_name, pr: PULL_NO_RUNS.number },
    });

    expect(result.isError).toBe(true);
    const body = parseResultText(result as never) as { status: string; message: string };
    expect(body.status).toBe('error');
    expect(body.message).toContain(`PR #${PULL_NO_RUNS.number}`);
    expect(body.message).toContain('devdigest_run_agent_on_pr');
  });

  it('devdigest_get_findings with an unknown run_id returns the actionable cache-miss message naming the repo+pr alternative', async () => {
    const result = await client.callTool({
      name: 'devdigest_get_findings',
      arguments: { run_id: 'run-does-not-exist' },
    });

    expect(result.isError).toBe(true);
    const body = parseResultText(result as never) as { status: string; message: string };
    expect(body.status).toBe('error');
    expect(body.message).toContain('run-does-not-exist');
    expect(body.message).toContain('devdigest_get_findings');
    // REQ-8: the message must name the repo + pr alternative specifically,
    // not just gesture at "try again".
    expect(body.message).toContain('repo and pr');
    expect(body.message).toContain('devdigest_run_agent_on_pr');
  });

  it('devdigest_get_blast_radius returns not_implemented with isError:false and makes zero HTTP requests', async () => {
    const requestCountBefore = stub.getRequestCount();

    const result = await client.callTool({
      name: 'devdigest_get_blast_radius',
      arguments: { repo: REPO.full_name, pr: PULL.number },
    });

    expect(result.isError).toBe(false);
    const body = parseResultText(result as never) as {
      status: string;
      repo: string;
      pr: number;
    };
    expect(body.status).toBe('not_implemented');
    expect(body.repo).toBe(REPO.full_name);
    expect(body.pr).toBe(PULL.number);

    // REQ-14: the stub must have received zero additional requests for this call.
    expect(stub.getRequestCount()).toBe(requestCountBefore);
  });
});
