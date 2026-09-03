// Intended real path: server/src/vendor/shared/contracts/repo-health.ts
import { z } from 'zod';
import type { AgentRow } from '../../../db/rows.js';

/**
 * Repo health-summary contract — surfaced on the repo detail page.
 */

export const RepoHealthSummary = z.object({
  repo_id: z.string().uuid(),
  stale_agent_count: z.number().int(),
  last_indexed_at: z.string().datetime().nullable(),
});
export type RepoHealthSummary = z.infer<typeof RepoHealthSummary>;

export interface RepoHealthDetail extends RepoHealthSummary {
  stale_agents: AgentRow[];
}
