// `devdigest_run_agent_on_pr` — the only mutating tool (REQ-6, REQ-7, REQ-8,
// REQ-9, REQ-16).
//
// Implements the sequence from the plan's Behaviour specifications, adapted
// for the `(pr_id, agent_id)` signature (a deliberate deviation from the
// plan's original `(repo, pr, agent)` — see `mcp-server/INSIGHTS.md`):
//   1. Validate flat args — already done by the SDK against
//      `runAgentOnPrInputSchema` (T6) before this handler ever runs.
//   2. Resolve pr_id (the PR's internal id) -> {id, number} via T4's
//      `resolvePullById`.
//   3. Resolve agent_id (id or name) -> Agent via T4's `resolveAgent`.
//   4. POST /pulls/:prId/review { agentId } via T3's `startReview`, take
//      `runs[0].run_id`. The always-empty `reviews` field is ignored.
//   5. Poll `GET /pulls/:prId/runs` (T3's `listRuns`) every `pollIntervalMs`
//      for the row matching `run_id`, until its status leaves `'running'` or
//      `reviewTimeoutMs` elapses:
//        - `done` -> `GET /pulls/:prId/reviews` (T3's `listReviews`), find
//          the review whose `run_id` matches, trim its findings to the
//          run-result projection (REQ-9, dismissed findings excluded first),
//          return `{status: 'completed', ...}`.
//        - `failed`/`cancelled` -> `{status, run_id, error, next_step}`,
//          `isError: false`.
//        - timeout -> `{status: 'still_running', run_id, message}`,
//          `isError: false`. This NEVER calls `POST /runs/:id/cancel` — a
//          client-side abort genuinely cannot stop the server-side run
//          (execution is a detached promise, `service.ts:133`, and only
//          `POST /runs/:id/cancel` sets `status: 'cancelled'`,
//          `service.ts:85-90`), and T3's client doesn't even expose that
//          method, so not cancelling on timeout is correct, not merely
//          convenient.
//
// Exports finding-trimming machinery `devdigest_get_findings` imports rather
// than reimplementing: `CONCISE_FINDING_FIELDS`, `DETAILED_FINDING_FIELDS`,
// `RUN_RESULT_FINDING_FIELDS`, `pickFindingFields`, `excludeDismissedFindings`,
// `toRunResultFindings`. `stillRunning`/`failedRunResult` are NOT reused by
// `devdigest_get_findings` — that tool now groups every agent's runs into one
// array (each with its own inline status), rather than the whole tool result
// being a single `{status: 'still_running'|'failed'|'cancelled', ...}` shape
// the way this tool's own (single-run) result can be. See INSIGHTS.md.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiError, type DevDigestApiClient, type ReviewRunTarget } from '../api/client.js';
import { resolveAgent, resolvePullById, ResolveError } from '../api/resolve.js';
import type { ReviewRecord, RunSummary } from '../api/types.js';
import { runAgentOnPrInputSchema } from '../schemas.js';
import { RUN_AGENT_ON_PR_DESCRIPTION } from './shared-context.js';

/** One finding as it appears inside a `ReviewRecord.findings` array. */
type FindingRecord = ReviewRecord['findings'][number];

/** REQ-9 "concise" projection — exactly 7 keys. */
export const CONCISE_FINDING_FIELDS = [
  'severity',
  'category',
  'title',
  'file',
  'start_line',
  'end_line',
  'rationale',
] as const satisfies readonly (keyof FindingRecord)[];

/** REQ-9 "detailed" projection — the 7 concise keys plus 4 more (11 total). */
export const DETAILED_FINDING_FIELDS = [
  ...CONCISE_FINDING_FIELDS,
  'suggestion',
  'confidence',
  'id',
  'review_id',
] as const satisfies readonly (keyof FindingRecord)[];

/** REQ-9 "run result" projection (this tool's own) — detailed minus id/review_id (9 total). */
export const RUN_RESULT_FINDING_FIELDS = [
  'severity',
  'category',
  'title',
  'file',
  'start_line',
  'end_line',
  'rationale',
  'suggestion',
  'confidence',
] as const satisfies readonly (keyof FindingRecord)[];

export type ConciseFinding = Pick<FindingRecord, (typeof CONCISE_FINDING_FIELDS)[number]>;
export type DetailedFinding = Pick<FindingRecord, (typeof DETAILED_FINDING_FIELDS)[number]>;
export type RunResultFinding = Pick<FindingRecord, (typeof RUN_RESULT_FINDING_FIELDS)[number]>;

/**
 * Trims `finding` down to exactly `fields`. Generic over the field list so
 * T9 reuses this one function for all three REQ-9 projections (concise,
 * detailed, run-result) instead of each tool hand-rolling its own picker.
 */
export function pickFindingFields<F extends readonly (keyof FindingRecord)[]>(
  finding: FindingRecord,
  fields: F,
): Pick<FindingRecord, F[number]> {
  const result = {} as Pick<FindingRecord, F[number]>;
  for (const field of fields) {
    (result as Record<keyof FindingRecord, unknown>)[field] = finding[field];
  }
  return result;
}

/** Drops every finding with a non-null `dismissed_at` (REQ-9) — call this before any trimming/pagination. */
export function excludeDismissedFindings(findings: readonly FindingRecord[]): FindingRecord[] {
  return findings.filter((finding) => finding.dismissed_at === null);
}

/** Composes the dismissed-filter with the run-result projection — this tool's own finding shape. */
export function toRunResultFindings(findings: readonly FindingRecord[]): RunResultFinding[] {
  return excludeDismissedFindings(findings).map((finding) =>
    pickFindingFields(finding, RUN_RESULT_FINDING_FIELDS),
  );
}

/** Result shape for a review still running past the timeout budget (REQ-7). */
export interface StillRunningResult {
  status: 'still_running';
  run_id: string;
  message: string;
}

/**
 * Builds the "still running" result for this tool's own timeout branch
 * (step 6). Names both `devdigest_get_findings` and the `pr_id` to retry
 * with (REQ-8) — `devdigest_get_findings` no longer accepts `run_id` (it
 * takes `pr_id` and groups every agent's runs, see INSIGHTS.md), so `pr_id`
 * is the only valid way to check again.
 */
export function stillRunning(prId: string, runId: string): StillRunningResult {
  return {
    status: 'still_running',
    run_id: runId,
    message:
      'The review is still running after the ~5 min budget. It has not been cancelled — ' +
      `call devdigest_get_findings with pr_id="${prId}" in a bit to check again.`,
  };
}

/** Result shape for a run that ended in `failed` or `cancelled` (Behaviour spec, both paths). */
export interface FailedRunResult {
  status: 'failed' | 'cancelled';
  run_id: string;
  error: string | null;
  next_step: string;
}

/**
 * Builds the `failed`/`cancelled` result. Both this tool and
 * `devdigest_get_findings`'s repo+pr path (Behaviour spec, Path B step 5,
 * "the same error shape as Path A") return exactly this shape, surfacing the
 * server's own `RunSummary.error` text (REQ-8) plus a concrete next step.
 */
export function failedRunResult(run: {
  run_id: string;
  status: 'failed' | 'cancelled';
  error: string | null;
}): FailedRunResult {
  return {
    status: run.status,
    run_id: run.run_id,
    error: run.error,
    next_step:
      run.status === 'failed'
        ? `The run failed${run.error ? `: ${run.error}` : ''}. Try devdigest_run_agent_on_pr again, ` +
          'possibly with a different agent, or check the agent configuration in the DevDigest studio.'
        : 'The run was cancelled. Call devdigest_run_agent_on_pr again to start a fresh run.',
  };
}

export interface RunAgentOnPrDeps {
  client: DevDigestApiClient;
  /**
   * Max time (ms) to poll before returning `still_running` (T2's
   * `loadConfig().reviewTimeoutMs`, default 300000, "~5 min"). Injected —
   * never read from `process.env` here.
   */
  reviewTimeoutMs: number;
  /**
   * Interval (ms) between polls of `GET /pulls/:id/runs` (T2's
   * `loadConfig().pollIntervalMs`, default 2000). Injected — never read
   * from `process.env` here.
   */
  pollIntervalMs: number;
}

function textResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PollOutcome = { outcome: 'timeout' } | { outcome: 'settled'; run: RunSummary };

/**
 * Behaviour spec step 7: polls `GET /pulls/:prId/runs` every `pollIntervalMs`
 * for the row matching `runId`, until its status leaves `'running'` (becomes
 * `done`/`failed`/`cancelled`) or `reviewTimeoutMs` elapses. The first check
 * happens immediately (t=0, no initial sleep) — the review may already be
 * finished by the time this loop starts. Never issues a request more often
 * than once per `pollIntervalMs`.
 */
async function pollForRun(
  client: DevDigestApiClient,
  prId: string,
  runId: string,
  pollIntervalMs: number,
  reviewTimeoutMs: number,
): Promise<PollOutcome> {
  const startedAt = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() - startedAt >= reviewTimeoutMs) {
      return { outcome: 'timeout' };
    }

    const runs = await client.listRuns(prId);
    const match = runs.find((run) => run.run_id === runId);
    if (match && match.status !== null && match.status !== 'running') {
      return { outcome: 'settled', run: match };
    }

    await sleep(pollIntervalMs);
  }
}

/** Registers `devdigest_run_agent_on_pr` on `server` (REQ-5's namespaced name; REQ-16's annotations). */
export function registerRunAgentOnPrTool(server: McpServer, deps: RunAgentOnPrDeps): void {
  server.registerTool(
    'devdigest_run_agent_on_pr',
    {
      description: RUN_AGENT_ON_PR_DESCRIPTION,
      inputSchema: runAgentOnPrInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args): Promise<CallToolResult> => {
      // Steps 2-3: resolve pr_id -> pull, agent_id -> agent through T4's shared resolver.
      let pull;
      try {
        pull = await resolvePullById(deps.client, args.pr_id);
      } catch (err) {
        return errorResult(err);
      }

      let agent;
      try {
        agent = await resolveAgent(deps.client, args.agent_id);
      } catch (err) {
        return errorResult(err);
      }

      // Step 4: POST /pulls/:prId/review { agentId }, take runs[0]. The
      // always-empty `reviews` field (Context Finding 1) is never read.
      let runs: ReviewRunTarget[];
      try {
        runs = await deps.client.startReview(pull.id, agent.id);
      } catch (err) {
        return errorResult(err);
      }

      const run = runs[0];
      if (!run) {
        return textResult(
          {
            status: 'error',
            message:
              'The review request succeeded but returned no run — this is unexpected. ' +
              'Retry devdigest_run_agent_on_pr.',
          },
          true,
        );
      }

      // Step 5: poll until done/failed/cancelled or timeout. Never calls
      // POST /runs/:id/cancel on timeout — T3's client doesn't expose it.
      let pollResult: PollOutcome;
      try {
        pollResult = await pollForRun(
          deps.client,
          pull.id,
          run.run_id,
          deps.pollIntervalMs,
          deps.reviewTimeoutMs,
        );
      } catch (err) {
        return errorResult(err);
      }

      if (pollResult.outcome === 'timeout') {
        return textResult(stillRunning(pull.id, run.run_id));
      }

      const matchedRun = pollResult.run;

      if (matchedRun.status === 'failed' || matchedRun.status === 'cancelled') {
        return textResult(
          failedRunResult({
            run_id: matchedRun.run_id,
            status: matchedRun.status as 'failed' | 'cancelled',
            error: matchedRun.error,
          }),
        );
      }

      // status === 'done': fetch the matching review and project its findings.
      let reviews: ReviewRecord[];
      try {
        reviews = await deps.client.listReviews(pull.id);
      } catch (err) {
        return errorResult(err);
      }

      const review = reviews.find((r) => r.run_id === run.run_id);
      if (!review) {
        return textResult(
          {
            status: 'error',
            message:
              `Run ${run.run_id} finished but no matching review was found for PR #${pull.number}. ` +
              `Try devdigest_get_findings with pr_id="${pull.id}", or re-run devdigest_run_agent_on_pr.`,
          },
          true,
        );
      }

      return textResult({
        status: 'completed',
        verdict: review.verdict,
        summary: review.summary,
        score: review.score,
        run_id: run.run_id,
        agent_id: run.agent_id,
        agent_name: run.agent_name,
        pr_id: pull.id,
        pr: pull.number,
        findings: toRunResultFindings(review.findings),
      });
    },
  );
}
