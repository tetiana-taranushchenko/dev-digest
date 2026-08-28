"use client";

import { useAgents, usePrBrief, usePrReviews, useGenerateBrief } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { deriveVerdictInfo, pickDefaultAgent } from "./helpers";
import type { BriefSectionsState } from "./types";

/** The ONLY stateful piece of the Brief feature — called exactly once, by
 *  `OverviewTab.tsx` (T10), never by an individual panel. Its returned state
 *  is passed down to all three panels as a prop, so there is exactly one
 *  `useMutation()` instance in the whole tree and `mutation.isPending`/
 *  `mutation.isError` are trivially the single source of truth for every
 *  consumer — the fix for AC-25/AC-28 coordination (see T9 notes in
 *  docs/plans/pr-brief.md). Status check order (no-agent → loading → error →
 *  empty → ready) matters and must not be reordered.
 *
 *  `verdict` (the latest completed review run's verdict/score/findings) is a
 *  SEPARATE data source from the Brief itself — `usePrReviews` is the same
 *  hook `FindingsTab`/`ReviewRunAccordion` already use, so this doesn't add a
 *  new network round trip beyond React Query's existing cache for that key.
 *  It's computed independently of the Brief's own status (a PR can have a
 *  verdict with no Brief yet, or vice versa) and merged into the same card by
 *  explicit product direction — see `BriefVerdictInfo`'s doc comment. */
export function useBriefSections(prId: string | null): BriefSectionsState {
  const { data: agents } = useAgents();
  const agentId = pickDefaultAgent(agents ?? []);
  const { data, isLoading } = usePrBrief(prId, agentId);
  const mutation = useGenerateBrief(prId, agentId);
  const { data: reviews } = usePrReviews(prId);
  const verdict = deriveVerdictInfo(reviews ?? []);

  const generate = () => mutation.mutate({});
  const regenerate = () => mutation.mutate({ force: true });

  if (!agentId) {
    return {
      status: "no-agent",
      brief: null,
      usage: null,
      verdict,
      isMutating: false,
      errorMessage: null,
      generate,
      regenerate,
    };
  }
  if (isLoading || mutation.isPending) {
    return {
      status: "loading",
      brief: null,
      usage: null,
      verdict,
      isMutating: true,
      errorMessage: null,
      generate,
      regenerate,
    };
  }
  if (mutation.isError) {
    const msg =
      mutation.error instanceof ApiError ? mutation.error.message : "Couldn't generate this PR's brief.";
    return {
      status: "error",
      brief: null,
      usage: null,
      verdict,
      isMutating: false,
      errorMessage: msg,
      generate,
      regenerate,
    };
  }
  if (!data || data.brief === null) {
    return {
      status: "empty",
      brief: null,
      usage: null,
      verdict,
      isMutating: false,
      errorMessage: null,
      generate,
      regenerate,
    };
  }
  return {
    status: "ready",
    brief: data.brief,
    usage: { tokensIn: data.tokens_in ?? null, tokensOut: data.tokens_out ?? null, costUsd: data.cost_usd ?? null },
    verdict,
    isMutating: false,
    errorMessage: null,
    generate,
    regenerate,
  };
}
