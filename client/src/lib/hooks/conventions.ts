"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionStatus,
  Skill,
} from "@devdigest/shared";
import { api } from "../api";

export interface ConventionSkillDraft {
  name: string;
  description: string;
  body: string;
  enabled: boolean;
  candidate_count: number;
  evidence_files: string[];
}

export function useConventions(repoId: string | null) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`),
    onSuccess: (data) => qc.setQueryData(["conventions", repoId], data),
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: Partial<{
    category: ConventionCategory;
    rule: string;
    status: ConventionStatus;
  }>;
}

export function useUpdateConvention(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/repos/${repoId}/conventions/${id}`, patch),
    onSuccess: (updated) => {
      qc.setQueryData<ConventionCandidate[]>(["conventions", repoId], (current) =>
        current?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
      );
      qc.invalidateQueries({ queryKey: ["convention-skill-draft", repoId] });
    },
  });
}

export function useConventionSkillDraft(repoId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["convention-skill-draft", repoId],
    queryFn: () =>
      api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: !!repoId && enabled,
  });
}

export interface CreateConventionSkillInput {
  name: string;
  description: string;
  body: string;
  enabled: boolean;
}

export function useCreateConventionSkill(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConventionSkillInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

