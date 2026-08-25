"use client";

import { useQuery } from "@tanstack/react-query";
import type { BlastRadius } from "@devdigest/shared";
import { api } from "../api";

export function usePrBlastRadius(prId: string | null) {
  return useQuery({
    queryKey: ["pr-blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
    enabled: !!prId,
    // A missing blast radius should surface immediately as the empty/error
    // state, not after a retry delay (mirrors useSmartDiff in smart-diff.ts).
    retry: false,
  });
}
