/* hooks/agents.ts — React Query hooks for the A2 Agents tab + Agent Editor. */
"use client";

import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { Agent, AgentSkillLink, AttachedContextDoc, ModelInfo, Provider, ReviewStrategy } from "@devdigest/shared";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<Agent[]>("/agents"),
  });
}

export function useAgent(id: string | null | undefined) {
  return useQuery({
    queryKey: ["agent", id],
    queryFn: () => api.get<Agent>(`/agents/${id}`),
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  enabled?: boolean;
}

export function useCreateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAgentInput) => api.post<Agent>("/agents", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
  });
}

export interface UpdateAgentInput {
  id: string;
  patch: Partial<
    Pick<
      Agent,
      | "name"
      | "description"
      | "provider"
      | "model"
      | "system_prompt"
      | "output_schema"
      | "strategy"
      | "ci_fail_on"
      | "repo_intel"
      | "enabled"
    >
  >;
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateAgentInput) => api.put<Agent>(`/agents/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.setQueryData(["agent", data.id], data);
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/agents/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.removeQueries({ queryKey: ["agent", id] });
    },
  });
}

/** Dynamic model list for a provider (editor model picker). */
export function useProviderModels(provider: Provider | null | undefined) {
  return useQuery({
    queryKey: ["provider-models", provider],
    queryFn: () => api.get<ModelInfo[]>(`/providers/${provider}/models`),
    enabled: !!provider,
    staleTime: 5 * 60_000,
  });
}

/** Ordered skill links for an agent (Skills tab). */
export function useAgentSkills(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-skills", agentId],
    queryFn: () => api.get<AgentSkillLink[]>(`/agents/${agentId}/skills`),
    enabled: !!agentId,
  });
}

/** Replace an agent's whole ordered skill set in one call
    (delete-all-then-reinsert-with-order server-side). */
export function useSetAgentSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, skillIds }: { agentId: string; skillIds: string[] }) =>
      api.post<AgentSkillLink[]>(`/agents/${agentId}/skills`, { skill_ids: skillIds }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-skills", agentId] });
      // Linking/unlinking a skill changes which agents effectively "use"
      // every document that skill has attached — the repo-wide listing's
      // "used by N agents" count (server-computed across direct + enabled-
      // linked-skill attachments) must be refetched too, or it stays stale.
      qc.invalidateQueries({ queryKey: ["context"] });
    },
  });
}

/** This agent's own attached Project Context documents, in persisted order —
    each flags whether it still resolves against the current clone (AC-9). */
export function useAgentContext(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-context", agentId],
    queryFn: () => api.get<AttachedContextDoc[]>(`/agents/${agentId}/context`),
    enabled: !!agentId,
  });
}

/** Replace an agent's whole ordered attached-doc path set in one call
    (paths only — never bodies; server resolves + persists order). */
export function useSetAgentContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, paths }: { agentId: string; paths: string[] }) =>
      api.put<AttachedContextDoc[]>(`/agents/${agentId}/context`, { paths }),
    onSuccess: (_data, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["agent-context", agentId] });
      // Attaching/detaching changes this document's "used by N agents" count,
      // which lives on the repo-wide listing (`useContextFiles`), not this
      // agent's own attached-set query — without this it stays stale until
      // something else happens to refetch it (e.g. a full page reload).
      qc.invalidateQueries({ queryKey: ["context"] });
    },
  });
}

/** Each enabled linked skill's own attached context docs, keyed by skill id
    order — needed for the Context tab's combined direct + enabled-linked-
    skill running total (AC-10). `lib/hooks/skills.ts` doesn't have a
    `useSkillContext` hook yet (that file is T16's owned path), so this
    queries `GET /skills/:id/context` directly rather than waiting on it. */
export function useLinkedSkillsContext(skillIds: string[]) {
  return useQueries({
    queries: skillIds.map((skillId) => ({
      queryKey: ["skill-context", skillId],
      queryFn: () => api.get<AttachedContextDoc[]>(`/skills/${skillId}/context`),
    })),
  });
}
