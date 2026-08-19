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
// The strings in this file are copied **verbatim** from this plan's
// "## Tool Descriptions (final text)" section (`docs/plans/mcp-server.md`) —
// that text was deliberately finalized in a separate review pass and must not
// be paraphrased, shortened, or "improved" here. T7-T10 import these constants
// into their `registerTool` calls rather than inlining their own text.
//
// REQ-7: every mention of the run_agent_on_pr timeout budget is written the
// same way, "~2 min", and nowhere as "~90s" — `test/schemas.test.ts` greps
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
  'model, enabled). Call this first to get a valid agent id for ' +
  'devdigest_run_agent_on_pr — do not guess or invent agent ids. Takes no ' +
  'arguments.';

/** `description` for `devdigest_run_agent_on_pr`. */
export const RUN_AGENT_ON_PR_DESCRIPTION =
  'Run one reviewer agent on a pull request and return the result — this ' +
  'single call triggers the review, waits for it to finish (up to ~2 min), ' +
  'and returns the verdict and findings; you do not need to poll. Args: repo ' +
  '(owner/name, e.g. "acme/payments-api"), pr (the GitHub PR number, e.g. ' +
  '482, not an internal id), agent (an id from devdigest_list_agents — do not ' +
  'guess it). If the review is still running after ~2 min, the result is ' +
  "{status:'still_running', run_id}; call devdigest_get_findings with that " +
  'run_id (or with repo+pr) later.';

/** `description` for `devdigest_get_findings`. */
export const GET_FINDINGS_DESCRIPTION =
  'Get the verdict and findings of an already-started review run. Identify it ' +
  'either by run_id (returned by devdigest_run_agent_on_pr — prefer this when ' +
  'you have it) or by repo+pr (looks up the most recent run for that PR). ' +
  'Defaults to a concise summary (severity, category, title, file, start_line, ' +
  "end_line, rationale); pass response_format:'detailed' for the full set " +
  '(adds suggestion, confidence, id, review_id — needed to call the ' +
  'accept/dismiss endpoints on one finding). Use offset/limit to page through ' +
  'large result sets (default limit 25). If run_id is unknown, or repo+pr ' +
  'never had a review run, the result names the fix.';

/** `description` for `devdigest_get_conventions`. */
export const GET_CONVENTIONS_DESCRIPTION =
  "Get this repository's extracted coding conventions (category, rule, " +
  'evidence_ref, confidence, accepted). Args: repo (owner/name). Use this to ' +
  "check or justify a finding against the repo's house rules; if none have " +
  'been extracted yet, the result points at the Conventions page.';

/** `description` for `devdigest_get_blast_radius`. */
export const GET_BLAST_RADIUS_DESCRIPTION =
  '⚠️ STUB — not yet implemented. Will eventually map which files/symbols a ' +
  "PR's changes affect elsewhere in the repo (reads repo-intel). Args: repo, " +
  'pr — same required shape as devdigest_run_agent_on_pr, so the contract ' +
  "won't change later. Always returns {status:'not_implemented', ...} with no " +
  'real data — do not rely on its output.';
