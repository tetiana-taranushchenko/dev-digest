// Tool input schemas.
//
// SDK 1.30.0's `registerTool(name, config, handler)` expects `config.inputSchema`
// to be a **raw object of Zod validators** — e.g. `{ repo: z.string(), pr:
// z.number() }` — not a wrapping `z.object({...})` (`dist/esm/server/mcp.d.ts:
// 150-157`, verified against the published tarball this session — see the
// plan's "Verified MCP SDK 1.30.0 facts" section). Every schema exported below
// follows that shape.
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
  )
  .describe('Repository full name, "owner/name" (GitHub\'s full_name), e.g. "acme/payments-api".');

/** A GitHub PR number (not an internal id). Must be a positive integer. */
export const prSchema = z
  .number()
  .int()
  .positive()
  .describe('The GitHub pull request number (not the internal pr_id), e.g. 42.');

/**
 * A PR's internal DevDigest id (opaque, workspace-scoped) — NOT the GitHub
 * PR number `prSchema` validates. Accepted by devdigest_run_agent_on_pr's
 * `resolvePullById` resolver (T4).
 */
export const prIdSchema = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The PR\'s internal DevDigest id (a UUID, not the GitHub PR number), ' +
      'e.g. "a23e635c-cb87-4230-8bb8-ff3fa63d1c30". Find it in the DevDigest app or in a ' +
      'prior tool call\'s response.',
  );

/**
 * A repo's internal DevDigest id (opaque, workspace-scoped) — NOT its
 * "owner/name" `repoSchema` validates. Accepted by devdigest_get_conventions'
 * `resolveRepoById` resolver (T4).
 */
export const repoIdSchema = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'The repo\'s internal DevDigest id (a UUID, not "owner/name"), ' +
      'e.g. "7da92249-2b69-44ce-b4a5-a1baa62853b1".',
  );

/** An agent id or name, as accepted by devdigest_run_agent_on_pr's resolver (T4). */
export const agentSchema = z
  .string()
  .min(1)
  .max(200)
  .describe(
    'A reviewer agent\'s id or name, e.g. "code-quality-bot". Call devdigest_list_agents ' +
      'to get valid values.',
  );

/** devdigest_list_agents takes no arguments. */
export const listAgentsInputSchema = {};

/** devdigest_run_agent_on_pr(pr_id, agent_id) — both required. */
export const runAgentOnPrInputSchema = {
  pr_id: prIdSchema,
  agent_id: agentSchema,
};

/**
 * devdigest_get_findings(pr_id, all_runs?) — pr_id required. Returns the
 * latest review per agent (or every run per agent when `all_runs` is true),
 * so there is exactly one identifier and no cross-field rule to enforce.
 */
export const getFindingsInputSchema = {
  pr_id: prIdSchema,
  all_runs: z
    .boolean()
    .default(false)
    .describe(
      'When true, return every run per agent instead of just the latest one. Default false, e.g. true.',
    ),
};

/**
 * devdigest_get_conventions(repo_id) — required. `repo_id` is the repo's
 * internal DevDigest id (`repoIdSchema`), resolved via `resolveRepoById` —
 * NOT the "owner/name" `repoSchema` validates (a deliberate correction: an
 * earlier pass renamed the field but kept the "owner/name" value; this pass
 * makes it a real internal id, matching `pr_id`'s pattern — see INSIGHTS.md).
 */
export const getConventionsInputSchema = {
  repo_id: repoIdSchema,
};

/**
 * devdigest_get_blast_radius(pr_id) — required. Matches
 * devdigest_run_agent_on_pr/devdigest_get_findings's pr_id shape now that
 * this tool is implemented, not a stub.
 */
export const getBlastRadiusInputSchema = {
  pr_id: prIdSchema,
};
