// `devdigest_get_conventions` — resolves `repo_id` (the repo's internal id)
// via T4's shared resolver (`resolveRepoById`, `api/resolve.ts`) and wraps
// `GET /repos/:id/conventions`,
// trimmed to exactly the fields a caller needs to check or justify a finding
// against the repo's house rules: `{ category, rule, evidence_ref,
// confidence, accepted }`.
//
// Every one of those is a real field of `ConventionCandidate`
// (`server/src/vendor/shared/contracts/knowledge.ts:167-179`): `evidence_ref`
// at :174, `confidence` at :175, `accepted` — a real boolean, "true exactly
// when status is `approved`" — at :177-178. There is deliberately **no**
// `file` field on this contract, and `status` is dropped even though it
// exists (`accepted` is its boolean projection). `id`, `evidence_path`,
// `evidence_line`, `evidence_snippet` are also dropped as internal
// bookkeeping this tool's caller has no use for.
//
// `resolveRepoById` is imported and called directly — this tool does not
// reimplement the `GET /repos` lookup (see `api/resolve.ts`'s module doc,
// which lists this tool as one of its four consumers).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { DevDigestApiClient } from '../api/client.js';
import { ApiError } from '../api/client.js';
import { resolveRepoById, ResolveError } from '../api/resolve.js';
import { getConventionsInputSchema } from '../schemas.js';
import { GET_CONVENTIONS_DESCRIPTION } from './shared-context.js';

export interface GetConventionsDeps {
  client: DevDigestApiClient;
}

/** The exact, compact projection this tool returns per convention (REQ-9's sibling for conventions). */
export interface ConventionSummary {
  category: string;
  rule: string;
  evidence_ref: string;
  confidence: number;
  accepted: boolean;
}

function textResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

/** Trims a full `ConventionCandidate` down to exactly the 5 keys this tool returns. */
function toSummary(convention: {
  category: string;
  rule: string;
  evidence_ref: string;
  confidence: number;
  accepted: boolean;
}): ConventionSummary {
  return {
    category: convention.category,
    rule: convention.rule,
    evidence_ref: convention.evidence_ref,
    confidence: convention.confidence,
    accepted: convention.accepted,
  };
}

/** Registers `devdigest_get_conventions` on `server` (REQ-5's namespaced name). */
export function registerGetConventionsTool(server: McpServer, deps: GetConventionsDeps): void {
  server.registerTool(
    'devdigest_get_conventions',
    {
      description: GET_CONVENTIONS_DESCRIPTION,
      inputSchema: getConventionsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ repo_id }): Promise<CallToolResult> => {
      let repo;
      try {
        repo = await resolveRepoById(deps.client, repo_id);
      } catch (err) {
        if (err instanceof ResolveError) {
          return textResult({ status: 'error', message: err.message }, true);
        }
        throw err;
      }

      let conventions;
      try {
        conventions = await deps.client.listConventions(repo.id);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err);
        return textResult(
          {
            status: 'error',
            message: `Failed to list conventions for "${repo.full_name}": ${message}. Confirm the DevDigest studio is running and reachable, then retry devdigest_get_conventions.`,
          },
          true,
        );
      }

      if (conventions.length === 0) {
        // REQ-8: never a bare empty list — name the actionable next step.
        return textResult({
          status: 'empty',
          message:
            `No conventions have been extracted yet for "${repo.full_name}". Run the Conventions ` +
            'extractor for this repo in the DevDigest studio, then retry devdigest_get_conventions.',
          conventions: [],
        });
      }

      return textResult({ conventions: conventions.map(toSummary) });
    },
  );
}
