import { describe, expect, it, vi } from 'vitest';
import { DevDigestApiClient, type FetchLike } from '../src/api/client.js';
import { ResolveError, resolveAgent, resolvePull, resolveRepo } from '../src/api/resolve.js';

const BASE_URL = 'http://localhost:3001';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Builds a real `DevDigestApiClient` over a fake fetch that serves canned JSON per path, keeping tests hermetic and fast. */
function makeClient(routes: Record<string, unknown>): DevDigestApiClient {
  const fetchMock: FetchLike = vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace(BASE_URL, '');
    if (!(path in routes)) {
      throw new Error(`Unexpected request in test: ${path}`);
    }
    return jsonResponse(200, routes[path]);
  }) as FetchLike;
  return new DevDigestApiClient({ baseUrl: BASE_URL, fetch: fetchMock });
}

describe('resolveRepo', () => {
  it('matches full_name case-insensitively', async () => {
    const client = makeClient({
      '/repos': [
        { id: 'r1', full_name: 'Acme/Payments-Api' },
        { id: 'r2', full_name: 'acme/other' },
      ],
    });

    const repo = await resolveRepo(client, 'acme/payments-api');

    expect(repo).toEqual({ id: 'r1', full_name: 'Acme/Payments-Api' });
  });

  it('a miss throws an error enumerating the available full_names', async () => {
    const client = makeClient({
      '/repos': [
        { id: 'r1', full_name: 'acme/payments-api' },
        { id: 'r2', full_name: 'acme/other' },
      ],
    });

    await expect(resolveRepo(client, 'acme/missing')).rejects.toBeInstanceOf(ResolveError);
    await expect(resolveRepo(client, 'acme/missing')).rejects.toThrow(
      /acme\/payments-api.*acme\/other/s,
    );
  });

  it('a miss with zero repos still returns an actionable message, not a bare empty enumeration', async () => {
    const client = makeClient({ '/repos': [] });

    await expect(resolveRepo(client, 'acme/missing')).rejects.toThrow(
      /no repos are registered yet/,
    );
  });
});

describe('resolvePull', () => {
  it('matches PrMeta.number', async () => {
    const client = makeClient({
      '/repos/r1/pulls': [
        { id: 'pr-1', number: 100 },
        { id: 'pr-2', number: 200 },
      ],
    });

    const pull = await resolvePull(client, 'r1', 200);

    expect(pull).toEqual({ id: 'pr-2', number: 200 });
  });

  it('a miss throws an error enumerating the available numbers', async () => {
    const client = makeClient({
      '/repos/r1/pulls': [
        { id: 'pr-1', number: 100 },
        { id: 'pr-2', number: 200 },
      ],
    });

    await expect(resolvePull(client, 'r1', 999)).rejects.toBeInstanceOf(ResolveError);
    await expect(resolvePull(client, 'r1', 999)).rejects.toThrow(/100.*200/s);
  });

  it('a matched PR with a null id yields its own distinct actionable message, not a generic one', async () => {
    const client = makeClient({
      '/repos/r1/pulls': [{ id: null, number: 100 }],
    });

    await expect(resolvePull(client, 'r1', 100)).rejects.toBeInstanceOf(ResolveError);
    await expect(resolvePull(client, 'r1', 100)).rejects.toThrow(/no resolvable internal id/);
  });
});

describe('resolveAgent', () => {
  it('matches an agent id first', async () => {
    const client = makeClient({
      '/agents': [
        { id: 'agent-1', name: 'Reviewer', description: '', enabled: true, model: 'x' },
        { id: 'agent-2', name: 'Other', description: '', enabled: true, model: 'x' },
      ],
    });

    const agent = await resolveAgent(client, 'agent-1');

    expect(agent.id).toBe('agent-1');
  });

  it('falls back to a case-insensitive name match when the id is unknown', async () => {
    const client = makeClient({
      '/agents': [{ id: 'agent-1', name: 'Reviewer', description: '', enabled: true, model: 'x' }],
    });

    const agent = await resolveAgent(client, 'reviewer');

    expect(agent.id).toBe('agent-1');
  });

  it('neither an id nor a name match throws an error enumerating id + name pairs', async () => {
    const client = makeClient({
      '/agents': [
        { id: 'agent-1', name: 'Reviewer', description: '', enabled: true, model: 'x' },
        { id: 'agent-2', name: 'Other', description: '', enabled: true, model: 'x' },
      ],
    });

    await expect(resolveAgent(client, 'nope')).rejects.toBeInstanceOf(ResolveError);
    await expect(resolveAgent(client, 'nope')).rejects.toThrow(
      /agent-1 \(Reviewer\).*agent-2 \(Other\)/s,
    );
  });

  it('a matched but disabled agent is rejected with that fact stated explicitly', async () => {
    const client = makeClient({
      '/agents': [
        { id: 'agent-1', name: 'Reviewer', description: '', enabled: false, model: 'x' },
      ],
    });

    await expect(resolveAgent(client, 'agent-1')).rejects.toBeInstanceOf(ResolveError);
    await expect(resolveAgent(client, 'agent-1')).rejects.toThrow(/disabled/);
  });
});
