// `devdigest_get_findings` — gets the verdict and findings of an
// already-started review run (REQ-8, REQ-9, REQ-16).
//
// Implements the Behaviour spec's
// "devdigest_get_findings(run_id | repo + pr, response_format?, offset?, limit?)"
// section:
//   1. `checkFindingsIdentifier` (T6) enforces the "exactly one of run_id OR
//      repo+pr" cross-field rule the schema itself cannot express (SDK
//      1.30.0's raw-validator-object `inputSchema` has no `.refine()` seam).
//      A bad combination returns `isError: true` immediately, naming both
//      accepted call shapes (REQ-8).
//   2. Path A (`run_id`): looks the run_id up in T5's `RunCache`. A miss is
//      always recoverable — the message leads with "call again with repo and
//      pr", then offers re-running `devdigest_run_agent_on_pr` (REQ-8). A hit
//      recovers `prId`, and `GET /pulls/:prId/runs` (T3) locates the row
//      matching `run_id`.
//   3. Path B (`repo` + `pr`): resolves through T4's shared resolver, then
//      `GET /pulls/:prId/runs`. An empty array is a distinct actionable
//      message naming `devdigest_run_agent_on_pr`, never a bare empty result
//      (REQ-8). Otherwise the run with the newest `ran_at` is selected,
//      sorting defensively (null `ran_at` treated as oldest) rather than
//      trusting server ordering (`RunSummary.ran_at` is typed nullable,
//      `contracts/trace.ts:113`).
//   4. Both paths converge on one `RunSummary` row: `running` returns T8's
//      `stillRunning` result unchanged (same shape, not reinvented);
//      `failed`/`cancelled` returns T8's `failedRunResult`; otherwise (`done`)
//      `GET /pulls/:prId/reviews` (T3) is filtered to the review whose
//      `run_id` matches.
//   5. Projection and pagination, in this fixed order: exclude dismissed
//      findings first (T8's `excludeDismissedFindings`), then slice
//      `[offset, offset+limit)`, then project each remaining finding via T8's
//      `pickFindingFields` with the concise (default) or detailed field list
//      (REQ-9). `total` counts the non-dismissed findings before slicing;
//      `has_more` is true when the slice didn't reach the end, in which case
//      a `next_step` names the exact follow-up call with the next `offset`
//      (REQ-8).
//
// Deliberately imports rather than reimplements: T8's trimming machinery
// (`CONCISE_FINDING_FIELDS`, `DETAILED_FINDING_FIELDS`, `pickFindingFields`,
// `excludeDismissedFindings`) and its `stillRunning`/`failedRunResult`
// builders, plus T4's `resolveRepo`/`resolvePull`.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError, type DevDigestApiClient } from '../api/client.js';
import { resolvePull, resolveRepo, ResolveError } from '../api/resolve.js';
import type { ReviewRecord, RunSummary } from '../api/types.js';
import type { RunCache } from '../runs/run-cache.js';
import { checkFindingsIdentifier, getFindingsInputSchema } from '../schemas.js';
import {
  CONCISE_FINDING_FIELDS,
  DETAILED_FINDING_FIELDS,
  excludeDismissedFindings,
  failedRunResult,
  pickFindingFields,
  stillRunning,
} from './run-agent-on-pr.js';
import { GET_FINDINGS_DESCRIPTION } from './shared-context.js';

export interface GetFindingsDeps {
  client: DevDigestApiClient;
  runCache: RunCache;
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

/**
 * Picks the run with the newest `ran_at` out of a non-empty list, treating a
 * null/missing `ran_at` as the oldest possible value — defensive against
 * `GET /pulls/:id/runs`'s ordering changing server-side, since
 * `RunSummary.ran_at` is typed `string | null` (`contracts/trace.ts:113`).
 */
function pickNewestRun(runs: readonly RunSummary[]): RunSummary {
  return runs.reduce((newest, run) => {
    const runTime = run.ran_at ? Date.parse(run.ran_at) : -Infinity;
    const newestTime = newest.ran_at ? Date.parse(newest.ran_at) : -Infinity;
    return runTime > newestTime ? run : newest;
  });
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
      // Step 1: the cross-field "exactly one of run_id OR repo+pr" guard.
      const check = checkFindingsIdentifier({
        run_id: args.run_id,
        repo: args.repo,
        pr: args.pr,
      });
      if (!check.ok) {
        return textResult({ status: 'error', message: check.message }, true);
      }

      let prId: string;
      let repoFullName: string;
      let prNumber: number;

      if (check.mode === 'run_id') {
        // Path A: recover PR context from T5's process-lifetime cache.
        const cached = deps.runCache.lookup(check.run_id);
        if (!cached) {
          return textResult(
            {
              status: 'error',
              message:
                `run_id "${check.run_id}" was not found in this session's cache — it may be ` +
                'from a previous process, or never existed. Call devdigest_get_findings again ' +
                'with repo and pr instead, or re-run devdigest_run_agent_on_pr to start a new review.',
            },
            true,
          );
        }
        prId = cached.prId;
        repoFullName = cached.repoFullName;
        prNumber = cached.prNumber;
      } else {
        // Path B: resolve repo + pr through T4's shared resolver.
        let repo;
        try {
          repo = await resolveRepo(deps.client, check.repo);
        } catch (err) {
          return errorResult(err);
        }

        let pull;
        try {
          pull = await resolvePull(deps.client, repo.id, check.pr);
        } catch (err) {
          return errorResult(err);
        }

        prId = pull.id;
        repoFullName = repo.full_name;
        prNumber = pull.number;
      }

      let runs: RunSummary[];
      try {
        runs = await deps.client.listRuns(prId);
      } catch (err) {
        return errorResult(err);
      }

      let targetRun: RunSummary;

      if (check.mode === 'run_id') {
        const match = runs.find((run) => run.run_id === check.run_id);
        if (!match) {
          return textResult(
            {
              status: 'error',
              message:
                `run_id "${check.run_id}" was cached but no matching run was found for PR ` +
                `#${prNumber} in ${repoFullName}. Call devdigest_get_findings again with repo and ` +
                'pr instead, or re-run devdigest_run_agent_on_pr.',
            },
            true,
          );
        }
        targetRun = match;
      } else {
        // Path B, step 3: an empty array means the PR has no runs at all —
        // never a bare empty findings result (REQ-8).
        if (runs.length === 0) {
          return textResult(
            {
              status: 'error',
              message:
                `PR #${prNumber} in ${repoFullName} has no review runs yet. Call ` +
                `devdigest_run_agent_on_pr(repo="${repoFullName}", pr=${prNumber}, agent=<id from ` +
                'devdigest_list_agents>) to start one.',
            },
            true,
          );
        }
        // Path B, step 2: pick the most recent run, sorting defensively.
        targetRun = pickNewestRun(runs);
      }

      if (targetRun.status === 'running') {
        return textResult(stillRunning(targetRun.run_id));
      }

      if (targetRun.status === 'failed' || targetRun.status === 'cancelled') {
        return textResult(
          failedRunResult({
            run_id: targetRun.run_id,
            status: targetRun.status,
            error: targetRun.error,
          }),
        );
      }

      // status === 'done' (or otherwise settled): fetch the matching review.
      let reviews: ReviewRecord[];
      try {
        reviews = await deps.client.listReviews(prId);
      } catch (err) {
        return errorResult(err);
      }

      const review = reviews.find((r) => r.run_id === targetRun.run_id);
      if (!review) {
        return textResult(
          {
            status: 'error',
            message:
              `Run ${targetRun.run_id} finished but no matching review was found for PR ` +
              `#${prNumber} in ${repoFullName}. Try devdigest_get_findings again shortly, or ` +
              're-run devdigest_run_agent_on_pr.',
          },
          true,
        );
      }

      // Step 5: exclude dismissed findings BEFORE slicing, then paginate,
      // then project (REQ-9).
      const nonDismissed = excludeDismissedFindings(review.findings);
      const total = nonDismissed.length;
      const { offset, limit } = args;
      const sliced = nonDismissed.slice(offset, offset + limit);
      const fields = args.response_format === 'detailed' ? DETAILED_FINDING_FIELDS : CONCISE_FINDING_FIELDS;
      const findings = sliced.map((finding) => pickFindingFields(finding, fields));
      const returned = findings.length;
      const hasMore = offset + returned < total;

      const result: Record<string, unknown> = {
        status: 'completed',
        verdict: review.verdict,
        summary: review.summary,
        score: review.score,
        run_id: targetRun.run_id,
        agent_id: targetRun.agent_id,
        agent_name: targetRun.agent_name,
        repo: repoFullName,
        pr: prNumber,
        response_format: args.response_format,
        total,
        returned,
        offset,
        limit,
        has_more: hasMore,
        findings,
      };

      if (hasMore) {
        const identifierHint =
          check.mode === 'run_id'
            ? `run_id="${targetRun.run_id}"`
            : `repo="${repoFullName}", pr=${prNumber}`;
        result.next_step =
          `More findings are available — call devdigest_get_findings again with ${identifierHint} ` +
          `and offset=${offset + limit} (limit=${limit}) to get the next page.`;
      }

      return textResult(result);
    },
  );
}
