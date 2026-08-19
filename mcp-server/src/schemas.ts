// Tool input schemas.
//
// SDK 1.30.0's `registerTool(name, config, handler)` expects `config.inputSchema`
// to be a **raw object of Zod validators** — e.g. `{ repo: z.string(), pr:
// z.number() }` — not a wrapping `z.object({...})` (`dist/esm/server/mcp.d.ts:
// 150-157`, verified against the published tarball this session — see the
// plan's "Verified MCP SDK 1.30.0 facts" section). Every schema exported below
// follows that shape. It also means there is no `.refine()` seam for a
// cross-field rule — see `checkFindingsIdentifier` below.
//
// Every field is a flat primitive/enum (REQ-5, "Плоскі аргументи" — flat args
// are less error-prone for models, especially non-Anthropic ones). No schema
// value here is a nested object; `test/schemas.test.ts` asserts this by
// walking each exported schema.
import { z } from 'zod/v3';

/**
 * A repo full name, "owner/name" (GitHub's `full_name`). Rejects anything with
 * more or fewer than one `/`, and any character outside the GitHub-safe set —
 * which also rejects path-traversal-shaped payloads (`../../etc/passwd`,
 * absolute URLs) because those contain characters or slash counts the regex
 * doesn't allow. REQ-12: every interpolated path segment is additionally
 * URL-encoded before it reaches a URL (T3/T4's job) — this schema is the first
 * line of defense, not the only one.
 */
export const repoSchema = z
  .string()
  .max(200)
  .regex(
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/,
    'repo must be "owner/name" (a GitHub full_name), e.g. "acme/payments-api".',
  );

/** A GitHub PR number (not an internal id). Must be a positive integer. */
export const prSchema = z.number().int().positive();

/** An agent id or name, as accepted by devdigest_run_agent_on_pr's resolver (T4). */
export const agentSchema = z.string().min(1).max(200);

/** A run_id handle, as returned by a previous devdigest_run_agent_on_pr call. */
export const runIdSchema = z.string().min(1).max(200);

/** devdigest_list_agents takes no arguments. */
export const listAgentsInputSchema = {};

/** devdigest_run_agent_on_pr(repo, pr, agent) — all three required (REQ-5). */
export const runAgentOnPrInputSchema = {
  repo: repoSchema,
  pr: prSchema,
  agent: agentSchema,
};

/**
 * devdigest_get_findings(run_id | repo + pr, response_format?, offset?, limit?).
 *
 * All three identifiers are declared optional at the schema level — SDK
 * 1.30.0's raw-validator-object `inputSchema` has no `.refine()` seam for a
 * cross-field "exactly one of" rule (see the plan's Behaviour spec, "Two
 * mutually exclusive ways to name the review"). That rule is enforced by
 * `checkFindingsIdentifier` below, called from the handler (T9) after the
 * SDK's per-field validation has already run.
 */
export const getFindingsInputSchema = {
  run_id: runIdSchema.optional(),
  repo: repoSchema.optional(),
  pr: prSchema.optional(),
  response_format: z.enum(['concise', 'detailed']).default('concise'),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(25),
};

/** devdigest_get_conventions(repo) — repo required. */
export const getConventionsInputSchema = {
  repo: repoSchema,
};

/**
 * devdigest_get_blast_radius(repo, pr) — both required, identical to
 * devdigest_run_agent_on_pr's pair, deliberately (REQ-14): this is the final
 * schema shape, so it will not change when the real implementation lands.
 */
export const getBlastRadiusInputSchema = {
  repo: repoSchema,
  pr: prSchema,
};

/**
 * The result of validating devdigest_get_findings' cross-field "exactly one
 * of run_id OR repo+pr" rule (REQ-8). `ok: true` narrows to the mode the
 * caller actually used, so T9's handler doesn't need to re-check which
 * identifier(s) were given.
 */
export type FindingsIdentifierCheck =
  | { ok: true; mode: 'run_id'; run_id: string }
  | { ok: true; mode: 'repo_pr'; repo: string; pr: number }
  | { ok: false; message: string };

const FINDINGS_CALL_SHAPES =
  'Call devdigest_get_findings with exactly one of: (1) run_id alone (e.g. run_id="abc123", from a previous devdigest_run_agent_on_pr call), or (2) repo + pr together (e.g. repo="acme/payments-api", pr=482).';

/**
 * Enforces devdigest_get_findings' cross-field rule: exactly one of `run_id`
 * or `repo` + `pr` (both together) must be given. Cannot live in the schema
 * itself (see `getFindingsInputSchema`'s doc comment) — this is the
 * handler-side guard the Behaviour spec calls for, exported so T9 reuses it
 * rather than reimplementing the rule.
 *
 * Every failure message names both accepted call shapes (REQ-8).
 */
export function checkFindingsIdentifier(args: {
  run_id?: string | undefined;
  repo?: string | undefined;
  pr?: number | undefined;
}): FindingsIdentifierCheck {
  const hasRunId = args.run_id !== undefined;
  const hasRepo = args.repo !== undefined;
  const hasPr = args.pr !== undefined;

  // repo and pr must be given together — check this first so a partial pair
  // is diagnosed precisely, regardless of whether run_id is also present.
  if (hasRepo !== hasPr) {
    const given = hasRepo ? 'repo' : 'pr';
    const missing = hasRepo ? 'pr' : 'repo';
    return {
      ok: false,
      message: `repo and pr must be supplied together — got ${given} without ${missing}. ${FINDINGS_CALL_SHAPES}`,
    };
  }

  const hasRepoPr = hasRepo && hasPr;

  if (hasRunId && hasRepoPr) {
    return {
      ok: false,
      message: `run_id and repo+pr are mutually exclusive — pick one, not both. ${FINDINGS_CALL_SHAPES}`,
    };
  }

  if (!hasRunId && !hasRepoPr) {
    return {
      ok: false,
      message: `Neither run_id nor repo+pr was given — one is required to identify the review. ${FINDINGS_CALL_SHAPES}`,
    };
  }

  if (hasRunId) {
    return { ok: true, mode: 'run_id', run_id: args.run_id as string };
  }

  return { ok: true, mode: 'repo_pr', repo: args.repo as string, pr: args.pr as number };
}
