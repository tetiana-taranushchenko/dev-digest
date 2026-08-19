import { describe, expect, it, vi } from 'vitest';
import { ApiError, DevDigestApiClient, type FetchLike } from '../src/api/client.js';

const BASE_URL = 'http://localhost:3001';

function jsonResponse(status: number, body: unknown, statusText = ''): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

function makeClient(fetchImpl: FetchLike): DevDigestApiClient {
  return new DevDigestApiClient({ baseUrl: BASE_URL, fetch: fetchImpl });
}

describe('DevDigestApiClient', () => {
  it('happy path: GET /repos parses a 200 JSON array', async () => {
    const repos = [{ id: 'r1', full_name: 'acme/payments-api' }];
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, repos));

    const client = makeClient(fetchMock);
    const result = await client.listRepos();

    expect(result).toEqual(repos);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/repos`);
  });

  it('encodeURIComponent-wraps every interpolated path segment', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, []));
    const client = makeClient(fetchMock);

    await client.listPulls('repo id/with slash');

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/repos/${encodeURIComponent('repo id/with slash')}/pulls`);
    expect(url).not.toContain('repo id/with slash');
  });

  it('startReview POSTs { agentId } and returns only the runs array (reviews is always [])', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse(200, {
        pr_id: 'pr-1',
        runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Reviewer' }],
        reviews: [],
      }),
    );
    const client = makeClient(fetchMock);

    const runs = await client.startReview('pr-1', 'agent-1');

    expect(runs).toEqual([{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'Reviewer' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/pulls/${encodeURIComponent('pr-1')}/review`);
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ agentId: 'agent-1' }));
  });

  it('a 404 error envelope surfaces error.code and error.message as a typed ApiError', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      jsonResponse(
        404,
        { error: { code: 'not_found', message: 'Repo not found' } },
        'Not Found',
      ),
    );
    const client = makeClient(fetchMock);

    await expect(client.listRepos()).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'not_found',
      message: 'Repo not found',
    });
  });

  it('a non-JSON 500 body degrades to the status text instead of throwing a parse error', async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      new Response('<html>Internal Server Error</html>', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'content-type': 'text/html' },
      }),
    );
    const client = makeClient(fetchMock);

    await expect(client.listRepos()).rejects.toBeInstanceOf(ApiError);
    await expect(client.listRepos()).rejects.toMatchObject({
      status: 500,
      code: 'http_error',
      message: 'Internal Server Error',
    });
  });

  it('an abort produces a timeout ApiError naming the endpoint', async () => {
    const fetchMock = vi.fn<FetchLike>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal!.reason);
          });
        }),
    );
    const client = makeClient(fetchMock);

    await expect(client.listRepos(10)).rejects.toMatchObject({
      name: 'ApiError',
      code: 'timeout',
    });
    await expect(client.listRepos(10)).rejects.toThrow(/GET \/repos timed out after 10ms/);
  });

  it('health() parses GET /health', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, { status: 'ok' }));
    const client = makeClient(fetchMock);

    await expect(client.health()).resolves.toEqual({ status: 'ok' });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/health`);
  });
});
