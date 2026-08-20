// `devdigest_get_findings` — gets the latest review verdict and findings for
// a pull request, grouped by agent (REQ-9, REQ-16). Replaced an earlier
// `run_id | repo+pr` design at the user's explicit request, matching a
// reference tool's `(pr_id, all_runs?)` shape — see INSIGHTS.md.
//
// Implements devdigest_get_findings(pr_id, all_runs?):
//   1. Resolve pr_id -> pull via T4's `resolvePullById` (validates pr_id and
//      recovers the GitHub PR number for the result).
//   2. GET /pulls/:prId/runs (T3's `listRuns`) — every run across every
//      agent that has reviewed this PR. Empty -> an actionable "run a review
//      first" message naming devdigest_run_agent_on_pr, never a bare empty
//      result (REQ-8).
//   3. Group runs by agent_id. Per agent: `all_runs` false (default) keeps
//      only the newest run (by ran_at, defensive against ordering — null
//      treated as oldest, `RunSummary.ran_at` is typed nullable); `all_runs`
//      true keeps every run. The combined list is sorted newest-first.
//   4. GET /pulls/:prId/reviews (T3's `listReviews`) once, only if at least
//      one selected run is `done` — never fetched for a PR whose runs are
//      all still running/failed/cancelled.
//   5. Each selected run becomes one entry in the `reviews` array: `running`
//      carries no findings yet; `failed`/`cancelled` carries `error`; `done`
//      looks up its matching review, excludes dismissed findings first
//      (REQ-9), then projects to `DETAILED_FINDING_FIELDS` — there is no
//      response_format toggle in this design, so `id`/`review_id` are always
//      included, letting the caller act on one finding without a second call.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError, type DevDigestApiClient } from '../api/client.js';
import { resolvePullById, ResolveError } from '../api/resolve.js';
import type { ReviewRecord, RunSummary } from '../api/types.js';
import { getFindingsInputSchema } from '../schemas.js';
import { DETAILED_FINDING_FIELDS, excludeDismissedFindings, pickFindingFields } from './run-agent-on-pr.js';
import { GET_FINDINGS_DESCRIPTION } from './shared-context.js';

export interface GetFindingsDeps {
  client: DevDigestApiClient;
}

function textResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

/** Every failure path surfaces `err.message` verbatim (REQ-8) — `ResolveError`/`ApiError` messages are already actionable. */
function errorResult(err: unknown): CallToolResult {
  const message =
    err instanceof ResolveError || err instanceof ApiError || err instanceof Error
      ? err.message
      : String(err);
  return textResult({ status: 'error', message }, true);
}

/** Picks the run with the newest `ran_at` out of a non-empty list, treating a null/missing `ran_at` as oldest. */
function pickNewestRun(runs: readonly RunSummary[]): RunSummary {
  return runs.reduce((newest, run) => {
    const runTime = run.ran_at ? Date.parse(run.ran_at) : -Infinity;
    const newestTime = newest.ran_at ? Date.parse(newest.ran_at) : -Infinity;
    return runTime > newestTime ? run : newest;
  });
}

/** Groups runs by `agent_id`, falling back to `run_id` for the rare null `agent_id` so no run is silently dropped. */
function groupRunsByAgent(runs: readonly RunSummary[]): RunSummary[][] {
  const groups = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const key = run.agent_id ?? run.run_id;
    const group = groups.get(key);
    if (group) {
      group.push(run);
    } else {
      groups.set(key, [run]);
    }
  }
  return [...groups.values()];
}

/** Registers `devdigest_get_findings` on `server` (REQ-5's namespaced name; REQ-16's annotations). */
export function registerGetFindingsTool(server: McpServer, deps: GetFindingsDeps): void {
  server.registerTool(
    'devdigest_get_findings',
    {
      description: GET_FINDINGS_DESCRIPTION,
      inputSchema: getFindingsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args): Promise<CallToolResult> => {
      // Step 1: resolve pr_id -> pull, validating it and recovering the PR number.
      let pull;
      try {
        pull = await resolvePullById(deps.client, args.pr_id);
      } catch (err) {
        return errorResult(err);
      }

      // Step 2: every run across every agent for this PR.
      let runs: RunSummary[];
      try {
        runs = await deps.client.listRuns(pull.id);
      } catch (err) {
        return errorResult(err);
      }

      if (runs.length === 0) {
        return textResult(
          {
            status: 'error',
            message:
              `PR #${pull.number} has no review runs yet. Call devdigest_run_agent_on_pr(pr_id=` +
              `"${pull.id}", agent_id=<id from devdigest_list_agents>) to start one.`,
          },
          true,
        );
      }

      // Step 3: per agent, the newest run only (default) or every run (`all_runs`).
      const selectedRuns = groupRunsByAgent(runs)
        .flatMap((agentRuns) => (args.all_runs ? agentRuns : [pickNewestRun(agentRuns)]))
        .sort((a, b) => {
          const aTime = a.ran_at ? Date.parse(a.ran_at) : -Infinity;
          const bTime = b.ran_at ? Date.parse(b.ran_at) : -Infinity;
          return bTime - aTime;
        });

      // Step 4: fetch reviews once, only if at least one selected run needs one.
      let reviews: ReviewRecord[] = [];
      if (selectedRuns.some((run) => run.status === 'done')) {
        try {
          reviews = await deps.client.listReviews(pull.id);
        } catch (err) {
          return errorResult(err);
        }
      }

      // Step 5: project each selected run to its own entry in `reviews`.
      const reviewsOut = selectedRuns.map((run) => {
        const base = {
          run_id: run.run_id,
          agent_id: run.agent_id,
          agent_name: run.agent_name,
          status: run.status,
          ran_at: run.ran_at,
        };

        if (run.status === 'failed' || run.status === 'cancelled') {
          return { ...base, error: run.error };
        }

        if (run.status !== 'done') {
          // 'running', or an unexpected null status — no review to attach yet.
          return base;
        }

        const review = reviews.find((r) => r.run_id === run.run_id);
        if (!review) {
          return {
            ...base,
            status: 'error',
            message: `Run ${run.run_id} finished but no matching review was found.`,
          };
        }

        return {
          ...base,
          verdict: review.verdict,
          summary: review.summary,
          score: review.score,
          findings: excludeDismissedFindings(review.findings).map((finding) =>
            pickFindingFields(finding, DETAILED_FINDING_FIELDS),
          ),
        };
      });

      return textResult({
        status: 'completed',
        pr_id: pull.id,
        pr: pull.number,
        all_runs: args.all_runs,
        reviews: reviewsOut,
      });
    },
  );
}
