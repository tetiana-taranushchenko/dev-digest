// `devdigest_get_blast_radius` — resolves `pr_id` (the PR's internal
// DevDigest id) to a `{id, number}` via the shared `resolvePullById`
// resolver (`api/resolve.ts`) and wraps `GET /pulls/:id/blast`
// (`server/src/modules/blast/routes.ts:26`), trimmed to the fields a caller
// needs to reason about a PR's downstream impact: `{ status, message?,
// pr_id, index_status, truncated, changed_symbols, downstream: [{ symbol,
// file, caller_count, callers, endpoints_affected, crons_affected }] }`.
//
// This tool now matches `devdigest_run_agent_on_pr`/`devdigest_get_findings`'s
// `pr_id` input shape — it kept a `repo` + `pr` shape only while it was still
// a stub (`mcp-server/INSIGHTS.md`, "2026-08-20 — devdigest_run_agent_on_pr
// switched..."), and that reason no longer applies now that this tool calls
// the real `GET /pulls/:id/blast` route.
//
// The caller list is passed through as-is — the server has already applied
// `MAX_CALLERS_PER_SYMBOL`, so this tool's output and the PR-Overview UI's
// BLAST RADIUS card stay comparable 1:1.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { DevDigestApiClient } from '../api/client.js';
import { ApiError } from '../api/client.js';
import { resolvePullById, ResolveError } from '../api/resolve.js';
import { getBlastRadiusInputSchema } from '../schemas.js';
import { GET_BLAST_RADIUS_DESCRIPTION } from './shared-context.js';

export interface GetBlastRadiusDeps {
  client: DevDigestApiClient;
}

/** One caller row this tool returns, trimmed from `BlastCaller` (`contracts/brief.ts:68-73`). */
interface CallerSummary {
  file: string;
  line: number;
  name: string;
}

/** One `downstream[]` entry this tool returns, trimmed from `DownstreamImpact` (`contracts/brief.ts:90-101`). */
interface DownstreamSummary {
  symbol: string;
  file: string;
  caller_count: number;
  callers: CallerSummary[];
  endpoints_affected: string[];
  crons_affected: string[];
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
 * Passes the server's caller list through unchanged — REQ-11 (T11 notes):
 * do not trim it further than `MAX_CALLERS_PER_SYMBOL` already did
 * server-side, only re-key the field order for a stable output shape.
 */
function toDownstreamSummary(downstream: {
  symbol: string;
  file: string;
  caller_count: number;
  callers: Array<{ file: string; line: number; name: string }>;
  endpoints_affected: string[];
  crons_affected: string[];
}): DownstreamSummary {
  return {
    symbol: downstream.symbol,
    file: downstream.file,
    caller_count: downstream.caller_count,
    callers: downstream.callers.map((caller) => ({
      file: caller.file,
      line: caller.line,
      name: caller.name,
    })),
    endpoints_affected: downstream.endpoints_affected,
    crons_affected: downstream.crons_affected,
  };
}

/** Registers `devdigest_get_blast_radius` on `server` (REQ-5's namespaced name). */
export function registerGetBlastRadiusTool(server: McpServer, deps: GetBlastRadiusDeps): void {
  server.registerTool(
    'devdigest_get_blast_radius',
    {
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema: getBlastRadiusInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ pr_id }): Promise<CallToolResult> => {
      let pull;
      try {
        pull = await resolvePullById(deps.client, pr_id);
      } catch (err) {
        return errorResult(err);
      }

      let blast;
      try {
        blast = await deps.client.getBlastRadius(pull.id);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err);
        return textResult(
          {
            status: 'error',
            message:
              `Failed to get the blast radius for PR #${pull.number}: ` +
              `${message}. Confirm the DevDigest studio is running and reachable, then retry ` +
              'devdigest_get_blast_radius.',
          },
          true,
        );
      }

      const projection = {
        pr_id: pull.id,
        index_status: blast.index_status,
        truncated: blast.truncated,
        changed_symbols: blast.changed_symbols,
        downstream: blast.downstream.map(toDownstreamSummary),
      };

      // REQ-8: never a bare empty array/object — every non-'ok' state carries
      // an actionable `message`.
      if (blast.state === 'empty') {
        return textResult({
          status: 'empty',
          message:
            blast.reason_text ??
            `PR #${pull.number} has no downstream impact — its changed symbols have no known ` +
              'callers, endpoints, or crons.',
          ...projection,
        });
      }

      if (blast.state === 'partial' || blast.state === 'degraded') {
        return textResult({
          status: blast.state,
          message:
            blast.reason_text ?? `Blast radius result for PR #${pull.number} is ${blast.state}.`,
          ...projection,
        });
      }

      return textResult({ status: 'ok', ...projection });
    },
  );
}
