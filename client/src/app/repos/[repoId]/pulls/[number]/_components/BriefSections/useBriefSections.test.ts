import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { Agent, Brief, BriefResult } from "@devdigest/shared";
import { ApiError } from "@/lib/api";

const useAgentsMock = vi.fn();
const usePrBriefMock = vi.fn();
const useGenerateBriefMock = vi.fn();
const usePrReviewsMock = vi.fn();

vi.mock("@/lib/hooks", () => ({
  useAgents: (...args: unknown[]) => useAgentsMock(...args),
  usePrBrief: (...args: unknown[]) => usePrBriefMock(...args),
  useGenerateBrief: (...args: unknown[]) => useGenerateBriefMock(...args),
  usePrReviews: (...args: unknown[]) => usePrReviewsMock(...args),
}));

import { useBriefSections } from "./useBriefSections";

beforeEach(() => {
  // Default: no completed review runs — most tests aren't exercising the
  // merged verdict row, so keep it a no-op unless a test overrides it.
  usePrReviewsMock.mockReturnValue({ data: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Reviewer",
    description: "",
    provider: "openai",
    model: "gpt-5",
    system_prompt: "",
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    ...overrides,
  };
}

const BRIEF: Brief = {
  what: "what",
  why: "why",
  risk_level: "low",
  risks: [],
  review_focus: [],
};

function briefResult(overrides: Partial<BriefResult> = {}): BriefResult {
  return {
    brief: BRIEF,
    cached: true,
    state_key: "key-1",
    intent_available: true,
    blast_available: true,
    dropped_sections: [],
    dropped_citations: [],
    generated_at: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

describe("useBriefSections", () => {
  it("returns no-agent when there is no enabled agent to default to", () => {
    useAgentsMock.mockReturnValue({ data: [agent({ enabled: false })] });
    usePrBriefMock.mockReturnValue({ data: undefined, isLoading: false });
    useGenerateBriefMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });

    const { result } = renderHook(() => useBriefSections("pr-1"), { wrapper });

    expect(result.current.status).toBe("no-agent");
  });

  it("returns loading while the brief query is loading, empty when it resolves with no brief, and ready once a brief is present", () => {
    useAgentsMock.mockReturnValue({ data: [agent()] });
    useGenerateBriefMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });

    usePrBriefMock.mockReturnValue({ data: undefined, isLoading: true });
    const { result, rerender } = renderHook(() => useBriefSections("pr-1"), { wrapper });
    expect(result.current.status).toBe("loading");
    expect(result.current.isMutating).toBe(true);

    usePrBriefMock.mockReturnValue({ data: briefResult({ brief: null }), isLoading: false });
    rerender();
    expect(result.current.status).toBe("empty");

    usePrBriefMock.mockReturnValue({ data: briefResult({ brief: BRIEF }), isLoading: false });
    rerender();
    expect(result.current.status).toBe("ready");
    expect(result.current.brief).toEqual(BRIEF);
  });

  it("regenerate() drives the single shared mutation through loading, and a rejected mutation surfaces as status: error — proving the single-call-site design synchronizes state across consumers", () => {
    useAgentsMock.mockReturnValue({ data: [agent()] });
    usePrBriefMock.mockReturnValue({ data: briefResult({ brief: BRIEF }), isLoading: false });

    const mutate = vi.fn();
    useGenerateBriefMock.mockReturnValue({ mutate, isPending: false, isError: false, error: null });

    const { result, rerender } = renderHook(() => useBriefSections("pr-1"), { wrapper });
    expect(result.current.status).toBe("ready");

    result.current.regenerate();
    expect(mutate).toHaveBeenCalledWith({ force: true });

    // Simulate the shared mutation entering its pending phase.
    useGenerateBriefMock.mockReturnValue({ mutate, isPending: true, isError: false, error: null });
    rerender();
    expect(result.current.status).toBe("loading");
    expect(result.current.isMutating).toBe(true);

    // Simulate the shared mutation rejecting.
    useGenerateBriefMock.mockReturnValue({
      mutate,
      isPending: false,
      isError: true,
      error: new ApiError("Couldn't generate.", 500),
    });
    rerender();
    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Couldn't generate.");
  });

  it("falls back to a generic error message when the mutation error isn't an ApiError", () => {
    useAgentsMock.mockReturnValue({ data: [agent()] });
    usePrBriefMock.mockReturnValue({ data: briefResult({ brief: BRIEF }), isLoading: false });
    useGenerateBriefMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("network down"),
    });

    const { result } = renderHook(() => useBriefSections("pr-1"), { wrapper });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Couldn't generate this PR's brief.");
  });

  it("wires the latest review's verdict/score/findings through independently of the Brief's own status", () => {
    useAgentsMock.mockReturnValue({ data: [agent()] });
    usePrBriefMock.mockReturnValue({ data: briefResult({ brief: BRIEF }), isLoading: false });
    useGenerateBriefMock.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false, error: null });
    usePrReviewsMock.mockReturnValue({
      data: [
        {
          id: "r-1",
          pr_id: "pr-1",
          agent_id: "agent-1",
          run_id: "run-1",
          agent_name: "Reviewer",
          kind: "review",
          verdict: "approve",
          summary: "Looks good",
          score: 67,
          model: "gpt-5",
          created_at: "2026-08-29T00:00:00.000Z",
          findings: [],
        },
      ],
    });

    const { result } = renderHook(() => useBriefSections("pr-1"), { wrapper });

    expect(result.current.verdict).toEqual({
      verdict: "approve",
      score: 67,
      findingsCount: 0,
      blockers: 0,
      agentName: "Reviewer",
    });
  });
});
