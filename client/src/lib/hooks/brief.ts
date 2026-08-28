/* hooks/brief.ts — React Query hooks for the one-LLM-call PR Brief
   (GET /pulls/:id/brief, POST /pulls/:id/brief). Sibling to intent.ts/blast.ts. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BriefResult } from "@devdigest/shared";
import { api } from "../api";

export function usePrBrief(prId: string | null, agentId: string | null) {
  return useQuery({
    queryKey: ["pr-brief", prId, agentId],
    queryFn: () =>
      api.get<BriefResult>(
        `/pulls/${prId}/brief?agent_id=${encodeURIComponent(agentId!)}`,
      ),
    enabled: !!prId && !!agentId,
    retry: false,
  });
}

export function useGenerateBrief(prId: string | null, agentId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (opts: { force?: boolean } = {}) =>
      api.post<BriefResult>(`/pulls/${prId}/brief`, { agent_id: agentId, ...opts }),
    onSuccess: (data) => qc.setQueryData(["pr-brief", prId, agentId], data),
  });
}
