"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PrIntentRecord } from "@devdigest/shared";
import { api } from "../api";

export function usePrIntent(prId: string | null) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<PrIntentRecord>(`/pulls/${prId}/intent`),
    enabled: !!prId,
    // A 404 (no intent derived yet) should surface immediately as the empty
    // state, not after a retry delay.
    retry: false,
  });
}

export function useClassifyIntent(prId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    onSuccess: (data) => qc.setQueryData(["pr-intent", prId], data),
  });
}
