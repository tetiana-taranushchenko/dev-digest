import { describe, expect, it } from "vitest";
import type { Agent, FindingRecord, PrFile, ReviewRecord } from "@devdigest/shared";
import { deriveVerdictInfo, formatBriefUsage, pickDefaultAgent, resolveReviewFocusDestination } from "./helpers";

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

describe("pickDefaultAgent", () => {
  it("excludes disabled agents and picks the enabled one deterministically by name then id, regardless of input order", () => {
    const agents: Agent[] = [
      agent({ id: "c", name: "Zeta", enabled: true }),
      agent({ id: "b", name: "Alpha", enabled: false }),
      agent({ id: "a", name: "Alpha", enabled: true }),
    ];

    expect(pickDefaultAgent(agents)).toBe("a");
    // Reordering the same set produces the same pick.
    expect(pickDefaultAgent([...agents].reverse())).toBe("a");
  });

  it("breaks a name tie by id", () => {
    const agents: Agent[] = [
      agent({ id: "z-id", name: "Same Name", enabled: true }),
      agent({ id: "a-id", name: "Same Name", enabled: true }),
    ];

    expect(pickDefaultAgent(agents)).toBe("a-id");
  });

  it("returns null for an empty list or an all-disabled list", () => {
    expect(pickDefaultAgent([])).toBeNull();
    expect(pickDefaultAgent([agent({ enabled: false })])).toBeNull();
  });
});

describe("resolveReviewFocusDestination", () => {
  const files: PrFile[] = [{ path: "src/example.ts", additions: 1, deletions: 0, patch: null }];

  it("builds the in-app diff-line route when the file is part of the PR's diff", () => {
    const destination = resolveReviewFocusDestination({
      file: "src/example.ts",
      line: 17,
      files,
      repoId: "repo-1",
      prNumber: 42,
    });

    expect(destination).toEqual({
      kind: "in-app",
      route: "/repos/repo-1/pulls/42?tab=diff&file=src%2Fexample.ts&line=17",
    });
  });

  it("returns not-in-diff (no navigation) when the file is absent from the PR's files", () => {
    const destination = resolveReviewFocusDestination({
      file: "src/absent.ts",
      line: 5,
      files,
      repoId: "repo-1",
      prNumber: 42,
    });

    expect(destination).toEqual({ kind: "not-in-diff" });
  });
});

describe("formatBriefUsage", () => {
  it("returns null when there is no usage to show", () => {
    expect(formatBriefUsage(null)).toBeNull();
    expect(formatBriefUsage({ tokensIn: null, tokensOut: null, costUsd: null })).toBeNull();
  });

  it("formats cost to 3 decimals and tokens as compact in→out", () => {
    expect(formatBriefUsage({ tokensIn: 31000, tokensOut: 1200, costUsd: 0.0142 })).toEqual({
      cost: "$0.014",
      tokens: "31.0K→1.2K",
    });
  });

  it("formats sub-1000 token counts without a K suffix", () => {
    expect(formatBriefUsage({ tokensIn: 800, tokensOut: 120, costUsd: 0.002 })).toEqual({
      cost: "$0.002",
      tokens: "800→120",
    });
  });

  it("returns only the field that's known when the other half of usage is missing", () => {
    expect(formatBriefUsage({ tokensIn: null, tokensOut: null, costUsd: 0.01 })).toEqual({
      cost: "$0.010",
      tokens: null,
    });
    expect(formatBriefUsage({ tokensIn: 500, tokensOut: 100, costUsd: null })).toEqual({
      cost: null,
      tokens: "500→100",
    });
  });
});

function finding(overrides: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f-1",
    review_id: "r-1",
    accepted_at: null,
    dismissed_at: null,
    severity: "WARNING",
    category: "bug",
    title: "Finding",
    file: "src/example.ts",
    start_line: 1,
    end_line: 1,
    rationale: "because",
    confidence: 0.8,
    ...overrides,
  };
}

function review(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
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
    ...overrides,
  };
}

describe("deriveVerdictInfo", () => {
  it("returns null when there are no reviews", () => {
    expect(deriveVerdictInfo([])).toBeNull();
  });

  it("skips a summary/no-verdict record and picks the first review with a verdict (reviews are newest-first)", () => {
    const reviews = [
      review({ id: "r-2", kind: "summary", verdict: null }),
      review({ id: "r-1", verdict: "request_changes", score: 42 }),
    ];

    expect(deriveVerdictInfo(reviews)).toEqual({
      verdict: "request_changes",
      score: 42,
      findingsCount: 0,
      blockers: 0,
      agentName: "Reviewer",
    });
  });

  it("counts findingsCount as the full list, but blockers only as non-dismissed CRITICAL findings", () => {
    const reviews = [
      review({
        findings: [
          finding({ id: "f-1", severity: "CRITICAL", dismissed_at: null }),
          finding({ id: "f-2", severity: "CRITICAL", dismissed_at: "2026-08-29T00:00:00.000Z" }),
          finding({ id: "f-3", severity: "WARNING", dismissed_at: null }),
        ],
      }),
    ];

    const result = deriveVerdictInfo(reviews);
    expect(result?.findingsCount).toBe(3);
    expect(result?.blockers).toBe(1);
  });
});
