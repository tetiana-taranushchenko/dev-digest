// `devdigest_list_agents` — wraps `GET /agents` and trims each agent down to
// exactly the fields a caller needs to pick a valid `agent` id/name for
// `devdigest_run_agent_on_pr`: `{ id, name, description, enabled, model }`.
//
// `model` is a real field of the DTO (`toAgentDto` returns `model: row.model`,
// `server/src/modules/agents/helpers.ts:18`; `Agent.model` at
// `server/src/vendor/shared/contracts/knowledge.ts:209`) and is included
// because it is what a caller actually needs to pick an agent.
// `system_prompt`, `output_schema`, `provider`, `version`, `strategy`,
// `ci_fail_on`, `repo_intel`, `skill_count` are all dropped — internal
// bookkeeping the caller of this tool has no use for.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { DevDigestApiClient } from '../api/client.js';
import { ApiError } from '../api/client.js';
import { listAgentsInputSchema } from '../schemas.js';
import { LIST_AGENTS_DESCRIPTION } from './shared-context.js';

export interface ListAgentsDeps {
  client: DevDigestApiClient;
}

/** The exact, compact projection this tool returns per agent (REQ-9's sibling for agents). */
export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  model: string;
}

function textResult(data: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    isError,
  };
}

/** Trims a full `Agent` down to exactly the 5 keys this tool returns. */
function toSummary(agent: {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  model: string;
}): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    enabled: agent.enabled,
    model: agent.model,
  };
}

/** Registers `devdigest_list_agents` on `server` (REQ-5's namespaced name). */
export function registerListAgentsTool(server: McpServer, deps: ListAgentsDeps): void {
  server.registerTool(
    'devdigest_list_agents',
    {
      description: LIST_AGENTS_DESCRIPTION,
      inputSchema: listAgentsInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (): Promise<CallToolResult> => {
      let agents;
      try {
        agents = await deps.client.listAgents();
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err);
        return textResult(
          {
            status: 'error',
            message: `Failed to list agents: ${message}. Confirm the DevDigest studio is running and reachable, then retry devdigest_list_agents.`,
          },
          true,
        );
      }

      if (agents.length === 0) {
        // REQ-8: never a bare empty list — name the actionable next step.
        return textResult({
          status: 'empty',
          message:
            'No agents are configured in this DevDigest workspace yet. Create one in the ' +
            'DevDigest studio before calling devdigest_run_agent_on_pr.',
          agents: [],
        });
      }

      return textResult({ agents: agents.map(toSummary) });
    },
  );
}
