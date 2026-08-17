"use client";

import { useQuery } from "@tanstack/react-query";
import type { SmartDiff } from "@devdigest/shared";
import { api } from "../api";

export function useSmartDiff(prId: string | null) {
  return useQuery({
    queryKey: ["pr-smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
    // A missing smart-diff should surface immediately as the empty/error
    // state, not after a retry delay (mirrors usePrIntent in intent.ts).
    retry: false,
  });
}
