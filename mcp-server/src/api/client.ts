// Pure HTTP client for the local DevDigest API (REQ-3).
//
// Both dependencies — `baseUrl` and `fetch` — are injected via the
// constructor: no module-level `fetch` capture, no `process.env` read here
// (T12's composition root, `src/index.ts`, owns the one `process.env` read
// and feeds T2's `loadConfig` output in). That is what makes this client, and
// everything built on it, unit-testable with a fake fetch and no real network
// (see `test/api-client.test.ts`).
import { z } from 'zod';
import {
  AgentResponse,
  ApiError,
  ApiErrorEnvelope,
  BlastRadiusResponse,
  ConventionCandidateResponse,
  HealthResponse,
  PrDetailResponse,
  PrMetaResponse,
  RepoResponse,
  ReviewRecordResponse,
  ReviewRunResponse,
  RunSummaryResponse,
} from './types.js';
import type {
  Agent,
  BlastRadius,
  ConventionCandidate,
  HealthResponse as Health,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from './types.js';

export type FetchLike = typeof fetch;

export interface DevDigestApiClientOptions {
  /** Base URL of the local DevDigest API, no trailing slash (T2's `loadConfig` already normalises it). */
  baseUrl: string;
  /** Injected `fetch` implementation — Node's global `fetch` in production, a fake in tests. */
  fetch: FetchLike;
}

/** One entry of `startReview`'s resolved result — mirrors `ReviewRunTargetResponse`. */
export interface ReviewRunTarget {
  run_id: string;
  agent_id: string;
  agent_name: string;
}

/** Fallback per-request timeout when a caller doesn't pass its own budget. */
const DEFAULT_TIMEOUT_MS = 10_000;

function isTimeoutLikeError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

async function readBodySafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Non-JSON body — degrade to the status text at the call site rather than throwing here.
    return undefined;
  }
}

/**
 * Pure HTTP client of the local DevDigest API (`http://localhost:3001` by
 * default). Every path segment interpolated into a URL is
 * `encodeURIComponent`-wrapped (REQ-12) — repo/PR/run ids and agent ids are
 * untrusted, LLM-sourced strings by the time they reach here.
 */
export class DevDigestApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: DevDigestApiClientOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch;
  }

  /** `GET /repos` (`repos/routes.ts:33`). */
  async listRepos(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Repo[]> {
    const data = await this.request('GET', '/repos', undefined, timeoutMs);
    return z.array(RepoResponse).parse(data) as Repo[];
  }

  /** `GET /repos/:id/pulls` (`pulls/routes.ts:27`). */
  async listPulls(repoId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<PrMeta[]> {
    const path = `/repos/${encodeURIComponent(repoId)}/pulls`;
    const data = await this.request('GET', path, undefined, timeoutMs);
    return z.array(PrMetaResponse).parse(data) as PrMeta[];
  }

  /**
   * `GET /pulls/:id` (`pulls/routes.ts:35`) — full PR detail. Only `id` and
   * `number` are parsed; used to validate a caller-supplied internal `pr_id`
   * and recover its GitHub PR number for display.
   */
  async getPull(
    prId: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<{ id: string; number: number }> {
    const path = `/pulls/${encodeURIComponent(prId)}`;
    const data = await this.request('GET', path, undefined, timeoutMs);
    return PrDetailResponse.parse(data);
  }

  /** `GET /agents` (`agents/routes.ts:74`). */
  async listAgents(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Agent[]> {
    const data = await this.request('GET', '/agents', undefined, timeoutMs);
    return z.array(AgentResponse).parse(data) as Agent[];
  }

  /**
   * `POST /pulls/:id/review` (`reviews/routes.ts:27`), body `{ agentId }`.
   * Returns only the `runs` array — `reviews` is always `[]` on this endpoint
   * (Context Finding 1, `service.ts:137`) and is intentionally not surfaced.
   */
  async startReview(
    prId: string,
    agentId: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<ReviewRunTarget[]> {
    const path = `/pulls/${encodeURIComponent(prId)}/review`;
    const data = await this.request('POST', path, { agentId }, timeoutMs);
    return ReviewRunResponse.parse(data).runs;
  }

  /** `GET /pulls/:id/runs` (`reviews/routes.ts:101`), already newest-first server-side. */
  async listRuns(prId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<RunSummary[]> {
    const path = `/pulls/${encodeURIComponent(prId)}/runs`;
    const data = await this.request('GET', path, undefined, timeoutMs);
    return z.array(RunSummaryResponse).parse(data) as RunSummary[];
  }

  /** `GET /pulls/:id/reviews` (`reviews/routes.ts:129`). */
  async listReviews(prId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ReviewRecord[]> {
    const path = `/pulls/${encodeURIComponent(prId)}/reviews`;
    const data = await this.request('GET', path, undefined, timeoutMs);
    return z.array(ReviewRecordResponse).parse(data) as ReviewRecord[];
  }

  /** `GET /repos/:id/conventions` (`conventions/routes.ts:21`), already filtered to grounded rows server-side. */
  async listConventions(
    repoId: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<ConventionCandidate[]> {
    const path = `/repos/${encodeURIComponent(repoId)}/conventions`;
    const data = await this.request('GET', path, undefined, timeoutMs);
    return z.array(ConventionCandidateResponse).parse(data) as ConventionCandidate[];
  }

  /**
   * `GET /pulls/:id/blast` (`server/src/modules/blast/routes.ts:26`) — the
   * Blast Radius view: changed symbols, their callers, and reachable HTTP
   * endpoints/cron jobs, derived from the persisted repo-intel index only
   * (no AST/import-graph recomputation, no LLM call on this path).
   */
  async getBlastRadius(prId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<BlastRadius> {
    const path = `/pulls/${encodeURIComponent(prId)}/blast`;
    const data = await this.request('GET', path, undefined, timeoutMs);
    return BlastRadiusResponse.parse(data) as BlastRadius;
  }

  /** `GET /health` (`server/src/app.ts:112`), rate-limit exempt — used for the startup connectivity check. */
  async health(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Health> {
    const data = await this.request('GET', '/health', undefined, timeoutMs);
    return HealthResponse.parse(data);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const signal = AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        signal,
        ...(body !== undefined
          ? {
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {}),
      });
    } catch (err) {
      if (isTimeoutLikeError(err)) {
        throw new ApiError(
          0,
          'timeout',
          `Request to ${method} ${path} timed out after ${timeoutMs}ms`,
        );
      }
      throw err;
    }

    if (!response.ok) {
      const rawBody = await readBodySafely(response);
      const parsedEnvelope = ApiErrorEnvelope.safeParse(rawBody);
      if (parsedEnvelope.success) {
        throw new ApiError(
          response.status,
          parsedEnvelope.data.error.code,
          parsedEnvelope.data.error.message,
        );
      }
      // Non-JSON (or unrecognised) error body — degrade to the status text instead of throwing a parse error.
      throw new ApiError(
        response.status,
        'http_error',
        response.statusText || `HTTP ${response.status} on ${method} ${path}`,
      );
    }

    return readBodySafely(response);
  }
}

export { ApiError } from './types.js';
