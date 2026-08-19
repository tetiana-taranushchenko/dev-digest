// `devdigest_get_blast_radius` — a deliberate, typed stub (REQ-14).
//
// Its input schema is already the final one: `repo` + `pr`, both required,
// identical to `devdigest_run_agent_on_pr`'s pair (`getBlastRadiusInputSchema`,
// `schemas.ts`) — so the schema will not change when the real implementation
// lands. The handler makes **no HTTP call at all** (no client method
// invocation, no resolver call) and always returns `isError: false` with
// `{ status: 'not_implemented', message, repo, pr }`.
//
// TODO(real Blast Radius): the future real data source is
// `server/src/modules/repo-intel/` — but no HTTP endpoint exposes blast
// radius today. `repo-intel/routes.ts` only serves
// `GET /repos/:id/index-state` and `POST /repos/:id/resync`
// (verified this session); a real implementation will need a **new server
// endpoint**, which is explicitly out of scope for this plan (see
// docs/plans/mcp-server.md, "Out of Scope").
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getBlastRadiusInputSchema } from '../schemas.js';
import { GET_BLAST_RADIUS_DESCRIPTION } from './shared-context.js';

// No dependencies are needed — the stub makes no HTTP call, so it takes no
// API client. Typed as a permissive `object` (rather than an empty
// interface with lint noise) so a caller passing a larger shared deps bag
// (e.g. one that also carries `client` for the other tools) still type-checks.
export type GetBlastRadiusDeps = object;

function textResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

/** Registers `devdigest_get_blast_radius` on `server` (REQ-5's namespaced name). */
export function registerGetBlastRadiusTool(server: McpServer, _deps: GetBlastRadiusDeps): void {
  server.registerTool(
    'devdigest_get_blast_radius',
    {
      description: GET_BLAST_RADIUS_DESCRIPTION,
      inputSchema: getBlastRadiusInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ repo, pr }): Promise<CallToolResult> => {
      // No HTTP call, no resolver call — REQ-14. This is a stub.
      return textResult(
        {
          status: 'not_implemented',
          message:
            'devdigest_get_blast_radius is not implemented yet — it always returns this stub ' +
            'response with no real data. Do not rely on its output.',
          repo,
          pr,
        },
        false,
      );
    },
  );
}
