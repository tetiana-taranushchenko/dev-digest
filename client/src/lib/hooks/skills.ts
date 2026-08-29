/* hooks/skills.ts — React Query hooks for the A1 Skills CRUD + versions API. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { AttachedContextDoc, Skill, SkillSource, SkillType } from "@devdigest/shared";

export function useSkills() {
  return useQuery({
    queryKey: ["skills"],
    queryFn: () => api.get<Skill[]>("/skills"),
  });
}

export function useSkill(id: string) {
  return useQuery({
    queryKey: ["skill", id],
    queryFn: () => api.get<Skill>(`/skills/${id}`),
    enabled: !!id,
  });
}

export interface CreateSkillInput {
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidence_files?: string[];
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSkillInput) => api.post<Skill>("/skills", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

export interface UpdateSkillInput {
  id: string;
  patch: Partial<
    Pick<Skill, "name" | "description" | "type" | "source" | "body" | "enabled" | "evidence_files"> & {
      vetted: boolean;
    }
  >;
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateSkillInput) => api.put<Skill>(`/skills/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.setQueryData(["skill", data.id], data);
      // Toggling `enabled` changes whether this skill's attached documents
      // count toward any linked agent's "used by N agents" (only an enabled
      // skill's attachments are injected/counted) — refetch the listing too.
      qc.invalidateQueries({ queryKey: ["context"] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/skills/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.removeQueries({ queryKey: ["skill", id] });
    },
  });
}

/** This skill's own attached Project Context documents, in persisted order —
    each flags whether it still resolves against the current clone (AC-9).
    Query key (`["skill-context", skillId]`) intentionally matches
    `useLinkedSkillsContext` (`lib/hooks/agents.ts`), which queried
    `GET /skills/:id/context` directly before this hook existed — sharing the
    key means both hooks share one cache entry per skill instead of issuing
    duplicate fetches. */
export function useSkillContext(skillId: string | null | undefined) {
  return useQuery({
    queryKey: ["skill-context", skillId],
    queryFn: () => api.get<AttachedContextDoc[]>(`/skills/${skillId}/context`),
    enabled: !!skillId,
  });
}

/** Replace a skill's whole ordered attached-doc path set in one call
    (paths only — never bodies; server resolves + persists order). */
export function useSetSkillContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ skillId, paths }: { skillId: string; paths: string[] }) =>
      api.put<AttachedContextDoc[]>(`/skills/${skillId}/context`, { paths }),
    onSuccess: (_data, { skillId }) => {
      qc.invalidateQueries({ queryKey: ["skill-context", skillId] });
      // Same reasoning as useSetAgentContext: this document's "used by N
      // agents" count lives on the repo-wide listing, not this skill's own
      // attached-set query.
      qc.invalidateQueries({ queryKey: ["context"] });
    },
  });
}

export interface SkillVersion {
  skill_id: string;
  version: number;
  body: string;
  summary: string;
  created_at: string;
}

/** Body-version history for a skill (newest first). */
export function useSkillVersions(id: string) {
  return useQuery({
    queryKey: ["skill-versions", id],
    queryFn: () => api.get<SkillVersion[]>(`/skills/${id}/versions`),
    enabled: !!id,
  });
}

export function useRestoreSkillVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.post<Skill>(`/skills/${id}/versions/${version}/restore`),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["skill", id] });
      qc.invalidateQueries({ queryKey: ["skill-versions", id] });
    },
  });
}

export interface SkillAgentLink {
  agent_id: string;
  agent_name: string;
  order: number;
}

/** Agents (in this workspace) that use this skill. */
export function useSkillAgents(id: string) {
  return useQuery({
    queryKey: ["skill-agents", id],
    queryFn: () => api.get<SkillAgentLink[]>(`/skills/${id}/agents`),
    enabled: !!id,
  });
}

/**
 * Stats for one skill — findings/pull-frequency/cost aggregates over agents
 * that currently have this skill attached (NEVER "findings this skill
 * caused" — see StatsTab copy). Backs the Skill Editor's Stats tab.
 */
export interface SkillStats {
  skill_id: string;
  skill_name: string;
  agent_count: number;
  agents: { id: string; name: string }[];
  pull_frequency: number | null;
  accept_rate: number | null;
  accepted: number;
  dismissed: number;
  pending: number;
  findings_30d: number;
  findings_by_category: Record<string, number>;
  estimated_cost_by_category: Record<string, number>;
}

export function useSkillStats(id: string) {
  return useQuery({
    queryKey: ["skill-stats", id],
    queryFn: () => api.get<SkillStats>(`/skills/${id}/stats`),
    enabled: !!id,
  });
}

/** Unsaved preview returned by the import routes — nothing is persisted yet. */
export interface SkillImportPreview {
  name: string;
  description: string;
  body: string;
  type: SkillType;
  source: SkillSource;
}

/** Upload a markdown file or a .zip archive; returns an unsaved preview. */
export function useImportSkillFile() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return api.upload<SkillImportPreview>("/skills/import/file", form);
    },
  });
}

/** Fetch a skill body from a URL server-side; returns an unsaved preview. */
export function useImportSkillUrl() {
  return useMutation({
    mutationFn: (url: string) => api.post<SkillImportPreview>("/skills/import/url", { url }),
  });
}

/** A curated community-catalog entry (static fixture, not a live search). */
export interface CommunitySkillEntry {
  slug: string;
  name: string;
  repo: string;
  stars: number;
  lang: string;
  desc: string;
  topics: string[];
  type: SkillType;
}

export interface CommunitySkillQuery {
  q?: string;
  lang?: string;
  topic?: string;
}

export function useCommunitySkills(query: CommunitySkillQuery) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.lang) params.set("lang", query.lang);
  if (query.topic) params.set("topic", query.topic);
  const qs = params.toString();
  return useQuery({
    queryKey: ["community-skills", query.q ?? "", query.lang ?? "", query.topic ?? ""],
    queryFn: () => api.get<CommunitySkillEntry[]>(`/skills/community${qs ? `?${qs}` : ""}`),
  });
}

/** Import a catalog entry directly — no preview step, the catalog already
 *  has the full body. Lands disabled + needs-vetting, same as any other
 *  community/imported skill. */
export function useImportCommunitySkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) => api.post<Skill>(`/skills/community/${slug}/import`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}
