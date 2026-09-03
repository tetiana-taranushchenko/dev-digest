"use client";

/**
 * useOwnerAgentVersions.ts — AC-46's data source: the agent-version
 * timeline a recent-run row's label is inferred against. Kept local to
 * this tree (not added to `lib/hooks/agents.ts`, out of T13's owned
 * paths) — calls the existing `GET /agents/:id/versions` endpoint
 * directly via `api`, same pattern `lib/hooks/agents.ts#useLinkedSkillsContext`
 * already uses for an endpoint with no dedicated hook file yet.
 */

import { useQuery } from "@tanstack/react-query";
import type { EvalOwnerKind } from "@devdigest/shared";
import { api } from "../../../../lib/api";
import { useAgents } from "../../../../lib/hooks/agents";
import { useSkillAgents } from "../../../../lib/hooks/skills";
import type { AgentVersionSnapshot } from "./helpers";

/**
 * AC-46's skill-owner half — mirrors the server's own `resolveAgent`
 * (`server/src/modules/eval/service.ts:299-318`): candidates sorted by
 * link `order` ascending, first whose agent is currently `enabled` wins.
 * Documented approximation (T13 notes, `docs/plans/eval-pipeline.md`): this
 * is the *currently*-linked enabled agent, not necessarily the one that
 * produced an older run if the skill's linked agent changed since.
 */
function pickLinkedEnabledAgentId(
  links: { agent_id: string; order: number }[],
  agents: { id: string; enabled: boolean }[],
): string | null {
  const sorted = [...links].sort((a, b) => a.order - b.order);
  for (const link of sorted) {
    if (agents.some((a) => a.id === link.agent_id && a.enabled)) return link.agent_id;
  }
  return null;
}

/**
 * The agent-version history to infer AC-46's per-run label against — the
 * owner's own versions for an `'agent'` owner, or its currently-linked
 * enabled agent's versions for a `'skill'` owner (no linked enabled agent
 * -> no version data, every row falls back to `NO_VERSION_LABEL`). Reuses
 * the existing `GET /agents/:id/versions` endpoint — no new endpoint.
 */
export function useOwnerAgentVersions(ownerKind: EvalOwnerKind, ownerId: string) {
  const { data: agents } = useAgents();
  const { data: skillLinks } = useSkillAgents(ownerKind === "skill" ? ownerId : "");

  const agentId = ownerKind === "agent" ? ownerId : pickLinkedEnabledAgentId(skillLinks ?? [], agents ?? []);

  return useQuery({
    queryKey: ["eval-owner-agent-versions", agentId],
    queryFn: () => api.get<AgentVersionSnapshot[]>(`/agents/${agentId}/versions`),
    enabled: !!agentId,
    retry: false,
  });
}
