// Narrow local response validation for the DevDigest HTTP API (REQ-4, REQ-12).
//
// Each schema below validates ONLY the fields this package actually reads —
// not the server's full contract — so an unrelated server-side field change
// cannot break this client, while a genuine shape drift on a field we depend
// on still fails loudly with a clear zod error instead of a silent crash
// downstream (Affected Modules & Contracts, "Contract changes ... none").
// `.passthrough()` keeps the rest of the server's payload intact (rather than
// stripping it) so the public method return types below — the FULL shared
// contract types, imported type-only — aren't lying about missing fields.
//
// The type-only import is REQ-4's chosen mechanism: because every use here is
// `import type`, it is fully erased at compile time — zero runtime dependency
// on `server/src/vendor/shared/`, no second zod module instance, no lockfile
// entanglement (see docs/plans/mcp-server.md, "Contract changes" §3).
import { z } from 'zod';
import type {
  Agent,
  ConventionCandidate,
  PrMeta,
  Repo,
  ReviewRecord,
  RunSummary,
} from '@devdigest/shared';

export type { Agent, ConventionCandidate, PrMeta, Repo, ReviewRecord, RunSummary };

/** Uniform error envelope returned by the API on non-2xx responses (`server/src/app.ts:131-174`). */
export const ApiErrorEnvelope = z
  .object({
    error: z
      .object({
        code: z.string(),
        message: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelope>;

/** `GET /repos` item — `full_name` is the "owner/name" identifier tools resolve against (`platform.ts:146`). */
export const RepoResponse = z
  .object({
    id: z.string(),
    full_name: z.string(),
  })
  .passthrough();

/** `GET /repos/:id/pulls` item — `id` is nullish per the shared contract (`platform.ts:159`). */
export const PrMetaResponse = z
  .object({
    id: z.string().nullish(),
    number: z.number().int(),
  })
  .passthrough();

/**
 * `GET /pulls/:id` response — only `id` and `number` are consumed by this
 * package (`resolvePullById`, T4). The full `PrDetail` payload carries diff
 * files/commits/body too, but nothing here reads them.
 */
export const PrDetailResponse = z
  .object({
    id: z.string(),
    number: z.number().int(),
  })
  .passthrough();

/** `GET /agents` item, built by `toAgentDto` (`agents/helpers.ts:12-27`). */
export const AgentResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    model: z.string(),
  })
  .passthrough();

/** One entry of `POST /pulls/:id/review`'s `runs` array (`reviews/routes.ts:43`). */
export const ReviewRunTargetResponse = z
  .object({
    run_id: z.string(),
    agent_id: z.string(),
    agent_name: z.string(),
  })
  .passthrough();

/**
 * `POST /pulls/:id/review` response. Only `runs` is consumed — `reviews` is
 * always `[]` (Context Finding 1, `service.ts:137`), so it is not modelled
 * here at all.
 */
export const ReviewRunResponse = z
  .object({
    runs: z.array(ReviewRunTargetResponse),
  })
  .passthrough();

/** `GET /pulls/:id/runs` item (`contracts/trace.ts:98-120`). */
export const RunSummaryResponse = z
  .object({
    run_id: z.string(),
    agent_id: z.string().nullable(),
    agent_name: z.string().nullable(),
    status: z.string().nullable(), // running | done | failed | cancelled
    error: z.string().nullable(),
    ran_at: z.string().nullable(),
  })
  .passthrough();

/** A finding nested in a `GET /pulls/:id/reviews` item (`contracts/review-api.ts:15-19`, `contracts/findings.ts:47-62`). */
export const FindingRecordResponse = z
  .object({
    id: z.string(),
    review_id: z.string(),
    severity: z.string(),
    category: z.string(),
    title: z.string(),
    file: z.string(),
    start_line: z.number().int(),
    end_line: z.number().int(),
    rationale: z.string(),
    suggestion: z.string().nullish(),
    confidence: z.number(),
    accepted_at: z.string().nullable(),
    dismissed_at: z.string().nullable(),
  })
  .passthrough();

/** `GET /pulls/:id/reviews` item (`contracts/review-api.ts:23-38`). */
export const ReviewRecordResponse = z
  .object({
    id: z.string(),
    pr_id: z.string(),
    agent_id: z.string().nullable(),
    run_id: z.string().nullable(),
    agent_name: z.string().nullish(),
    verdict: z.string().nullable(),
    summary: z.string().nullable(),
    score: z.number().int().nullable(),
    findings: z.array(FindingRecordResponse),
  })
  .passthrough();

/** `GET /repos/:id/conventions` item (`contracts/knowledge.ts:167-179`). */
export const ConventionCandidateResponse = z
  .object({
    category: z.string(),
    rule: z.string(),
    evidence_ref: z.string(),
    confidence: z.number(),
    accepted: z.boolean(),
  })
  .passthrough();

/** `GET /health` (`server/src/app.ts:112`). */
export const HealthResponse = z.object({ status: z.string() }).passthrough();
export type HealthResponse = z.infer<typeof HealthResponse>;

/** Typed error for a non-2xx API response or a client-side request failure (e.g. a timeout). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
