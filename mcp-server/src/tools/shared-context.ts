// Shared tool-facing text: the server-level glossary and the 5 per-tool
// `description` strings.
//
// REQ-11 ("Shared context written once"): the glossary — what a repo / PR /
// agent / finding is in DevDigest — lives in exactly one place,
// `SERVER_INSTRUCTIONS`, surfaced to the client via `ServerOptions.instructions`
// (T11's `new McpServer({...}, { instructions: SERVER_INSTRUCTIONS })`). It is
// deliberately kept brief so the 5 tool descriptions below only need to state
// their own result, non-obvious inputs, and next action.
//
// Originally copied verbatim from `docs/plans/mcp-server.md`'s "## Tool
// Descriptions (final text)" section; several have since been deliberately
// rewritten at the user's request (see INSIGHTS.md) — the plan file itself
// is left as the historical record, not kept in sync. T7-T10 import these
// constants into their `registerTool` calls rather than inlining their own
// text. Keep each description compact: state what the tool returns, clarify
// non-obvious inputs, and mention only the next action a caller needs.
//
// REQ-7: every mention of the run_agent_on_pr timeout budget is written the
// same way, "~5 min", and nowhere as "~90s" — `test/schemas.test.ts` greps
// these constants for the literal string "90" to guard against drift.

/** Server-level `instructions` (REQ-11's sole glossary). */
export const SERVER_INSTRUCTIONS =
  'DevDigest is a local-first AI PR reviewer. Repositories and pull requests use ' +
  'their internal repo_id and pr_id in tool calls. Use devdigest_list_agents to ' +
  'get valid agent_id values. A finding is a review issue with a severity, file, ' +
  'and line range.';

/** `description` for `devdigest_list_agents`. */
export const LIST_AGENTS_DESCRIPTION =
  'Lists configured reviewer agents and their IDs, models, and enabled status. ' +
  'Use an enabled agent_id with devdigest_run_agent_on_pr.';

/** `description` for `devdigest_run_agent_on_pr`. */
export const RUN_AGENT_ON_PR_DESCRIPTION =
  'Runs one reviewer agent on a PR and waits up to ~5 min for its verdict and findings. ' +
  'Requires an internal pr_id (not the GitHub number) and an agent_id from ' +
  'devdigest_list_agents. If still running, retry devdigest_get_findings later ' +
  'with the same pr_id.';

/** `description` for `devdigest_get_findings`. */
export const GET_FINDINGS_DESCRIPTION =
  'Returns review status, verdict, and findings for a PR, grouped by agent. ' +
  "Requires the PR's internal pr_id; set all_runs=true to include every run " +
  'instead of only the latest per agent.';

/** `description` for `devdigest_get_conventions`. */
export const GET_CONVENTIONS_DESCRIPTION =
  "Returns a repository's extracted coding conventions and supporting evidence. " +
  "Requires the repository's internal repo_id (not owner/name); use this to check " +
  'findings against project rules.';

/** `description` for `devdigest_get_blast_radius`. */
export const GET_BLAST_RADIUS_DESCRIPTION =
  "Returns a PR's changed symbols and their downstream callers, HTTP endpoints, " +
  'and cron jobs from the persisted repo-intel index. Requires the PR\'s internal ' +
  'pr_id and may return ok, empty, partial, or degraded based on index coverage.';
