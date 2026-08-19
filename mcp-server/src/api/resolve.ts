// Shared repo/PR/agent resolution against the local DevDigest API.
//
// This is ONE module used by four consumers:
//   - `devdigest_run_agent_on_pr` (T8) — resolves repo + pr + agent before
//     starting a review.
//   - `devdigest_get_findings`'s `repo` + `pr` path (T9, "Path B") — resolves
//     repo + pr before looking up the PR's most recent run.
//   - `devdigest_get_conventions` (T10) — resolves repo before listing its
//     conventions.
//   - `devdigest_get_blast_radius` (T10) — schema-only consumer: its input
//     shape mirrors `devdigest_run_agent_on_pr`'s `repo` + `pr` pair so the
//     contract won't change once the real implementation lands, but the stub
//     handler makes no HTTP call and therefore never calls the functions
//     below.
//
// The `GET /repos` lookup (and `GET /repos/:id/pulls`, `GET /agents`) is
// therefore performed exactly once per tool call, never duplicated per tool
// file. Every miss throws a `ResolveError` whose message enumerates the
// available options and states a concrete next step (REQ-8) — callers are
// expected to catch it and surface `error.message` verbatim as the tool's
// actionable result text.
import type { Agent, PrMeta, Repo } from './types.js';
import type { DevDigestApiClient } from './client.js';

/** Thrown by every resolver below. `message` is always actionable (REQ-8) — safe to surface verbatim to the caller. */
export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveError';
  }
}

/**
 * Resolves `repoFullName` ("owner/name") to a `Repo` by a case-insensitive
 * exact match on `full_name` (`platform.ts:146`). A miss lists every known
 * `full_name` so the caller can retry with a valid one.
 */
export async function resolveRepo(
  client: DevDigestApiClient,
  repoFullName: string,
): Promise<Repo> {
  const repos = await client.listRepos();
  const needle = repoFullName.toLowerCase();
  const match = repos.find((repo) => repo.full_name.toLowerCase() === needle);
  if (!match) {
    const known = repos.map((repo) => repo.full_name);
    const list = known.length > 0 ? known.join(', ') : '(no repos are registered yet)';
    throw new ResolveError(
      `Repo "${repoFullName}" was not found. Known repos: ${list}. ` +
        `Use one of these exact "owner/name" values.`,
    );
  }
  return match;
}

/**
 * Resolves `number` (the GitHub PR number, not an internal id) to a `PrMeta`
 * within `repoId` by matching `PrMeta.number` (`platform.ts:160`). A miss
 * lists every known number. A matched PR whose `id` is nullish
 * (`PrMeta.id`, `platform.ts:159` — a real possibility) is treated as
 * unresolvable with its own distinct, actionable message, since every
 * downstream call needs the internal `id`, not the PR number.
 */
export async function resolvePull(
  client: DevDigestApiClient,
  repoId: string,
  number: number,
): Promise<PrMeta & { id: string }> {
  const pulls = await client.listPulls(repoId);
  const match = pulls.find((pull) => pull.number === number);
  if (!match) {
    const known = pulls.map((pull) => pull.number);
    const list = known.length > 0 ? known.join(', ') : '(no PRs are indexed for this repo yet)';
    throw new ResolveError(
      `PR #${number} was not found for this repo. Known PR numbers: ${list}.`,
    );
  }
  if (match.id === null || match.id === undefined) {
    throw new ResolveError(
      `PR #${number} was found but has no resolvable internal id (it may still be syncing). ` +
        `Try again shortly, or pick a different PR number.`,
    );
  }
  return { ...match, id: match.id };
}

/**
 * Resolves `idOrName` to an enabled `Agent`, matching an agent id first,
 * then falling back to a case-insensitive `name` match. Neither → an error
 * listing every known `id` + `name` pair. A matched-but-disabled agent is
 * rejected with that fact stated explicitly, rather than silently treated as
 * a miss.
 */
export async function resolveAgent(
  client: DevDigestApiClient,
  idOrName: string,
): Promise<Agent> {
  const agents = await client.listAgents();
  const byId = agents.find((agent) => agent.id === idOrName);
  const needle = idOrName.toLowerCase();
  const match = byId ?? agents.find((agent) => agent.name.toLowerCase() === needle);

  if (!match) {
    const known = agents.map((agent) => `${agent.id} (${agent.name})`);
    const list =
      known.length > 0 ? known.join(', ') : '(no agents are configured in this workspace yet)';
    throw new ResolveError(
      `Agent "${idOrName}" was not found by id or name. Known agents (id (name)): ${list}. ` +
        `Call devdigest_list_agents to see valid ids.`,
    );
  }
  if (!match.enabled) {
    throw new ResolveError(
      `Agent "${match.name}" (${match.id}) was found but is disabled and cannot be run. ` +
        `Call devdigest_list_agents to pick an enabled agent.`,
    );
  }
  return match;
}
