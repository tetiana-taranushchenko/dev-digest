// Shared tool-facing text: the server-level glossary and the 5 per-tool
// `description` strings.
//
// REQ-11 ("Shared context written once"): the glossary — what a repo / PR /
// agent / finding is in DevDigest — lives in exactly one place,
// `SERVER_INSTRUCTIONS`, surfaced to the client via `ServerOptions.instructions`
// (T11's `new McpServer({...}, { instructions: SERVER_INSTRUCTIONS })`). It is
// deliberately NOT repeated inside any of the 5 tool descriptions below; each
// description states only its own params/types, one example, and a "use this
// when / not when" clause.
//
// Originally copied verbatim from `docs/plans/mcp-server.md`'s "## Tool
// Descriptions (final text)" section; several have since been deliberately
// rewritten at the user's request (see INSIGHTS.md) — the plan file itself
// is left as the historical record, not kept in sync. T7-T10 import these
// constants into their `registerTool` calls rather than inlining their own
// text. Each is one sentence, at the user's request.
//
// REQ-7: every mention of the run_agent_on_pr timeout budget is written the
// same way, "~5 min", and nowhere as "~90s" — `test/schemas.test.ts` greps
// these constants for the literal string "90" to guard against drift.

/** Server-level `instructions` (REQ-11's sole glossary). */
export const SERVER_INSTRUCTIONS =
  'DevDigest is a local-first AI PR review tool. A repo is identified as ' +
  '"owner/name" (its GitHub full name). A PR is identified by its GitHub ' +
  'number within that repo. An agent is a configured reviewer (a model + ' +
  'system prompt); look one up with devdigest_list_agents. A run is one ' +
  'execution of one agent against one PR, identified by a run_id. A finding ' +
  'is one issue an agent found, with a severity (CRITICAL/WARNING/SUGGESTION), ' +
  'a file, and a line range.';

/** `description` for `devdigest_list_agents`. */
export const LIST_AGENTS_DESCRIPTION =
  'List the reviewer agents configured in this DevDigest workspace (id, name, ' +
  'model, enabled) — call this first to get a valid agent id for ' +
  'devdigest_run_agent_on_pr (do not guess or invent one); takes no arguments.';

/** `description` for `devdigest_run_agent_on_pr`. */
export const RUN_AGENT_ON_PR_DESCRIPTION =
  'Run one reviewer agent on a pull request and return the result in one call ' +
  '(triggers the review, waits up to ~5 min, and returns the verdict and ' +
  "findings — or, past ~5 min, {status:'still_running', run_id}, in which case " +
  'call devdigest_get_findings with the same pr_id later); Args: pr_id (the ' +
  "PR's internal DevDigest id, NOT the GitHub PR number, e.g. " +
  '"a23e635c-cb87-4230-8bb8-ff3fa63d1c30"), agent_id (an id from ' +
  'devdigest_list_agents — do not guess it).';

/** `description` for `devdigest_get_findings`. */
export const GET_FINDINGS_DESCRIPTION =
  'Get the latest review verdict and findings for a pull request, grouped by ' +
  'agent — Args: pr_id (the same internal DevDigest id devdigest_run_agent_on_pr ' +
  'takes, e.g. "a23e635c-cb87-4230-8bb8-ff3fa63d1c30"), all_runs (optional ' +
  "boolean, default false, pass true for every run per agent instead of just " +
  "each agent's latest); each entry in the result's reviews array is one " +
  "agent's run ('running' has no findings yet, 'failed'/'cancelled' carries an " +
  "error, 'done' carries verdict/summary/score/findings with id/review_id " +
  'always included for the accept/dismiss endpoints), and if pr_id has no ' +
  'review runs at all the result names devdigest_run_agent_on_pr as the fix.';

/** `description` for `devdigest_get_conventions`. */
export const GET_CONVENTIONS_DESCRIPTION =
  "Get this repository's extracted coding conventions (category, rule, " +
  "evidence_ref, confidence, accepted) to check or justify a finding against " +
  "the repo's house rules — Args: repo_id (the repo's internal DevDigest id, " +
  'e.g. "7da92249-2b69-44ce-b4a5-a1baa62853b1" — not its "owner/name"); if ' +
  'none have been extracted yet, the result points at the Conventions page.';

/** `description` for `devdigest_get_blast_radius`. */
export const GET_BLAST_RADIUS_DESCRIPTION =
  '⚠️ STUB — not yet implemented, will eventually map which files/symbols a ' +
  "PR's changes affect elsewhere in the repo (reads repo-intel) — Args: repo " +
  "(owner/name), pr (the GitHub PR number), both required so the contract " +
  "won't change later; always returns {status:'not_implemented', ...} with no " +
  'real data, so do not rely on its output.';
