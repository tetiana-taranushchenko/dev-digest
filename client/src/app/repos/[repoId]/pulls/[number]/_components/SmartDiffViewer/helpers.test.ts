import { describe, it, expect } from "vitest";
import type {
  FindingRecord,
  PrFile,
  ReviewRecord,
  SmartDiffGroup,
} from "@devdigest/shared";

import {
  buildFileMap,
  projectSmartDiffFindings,
  selectLatestReviewRecords,
} from "./helpers";

function finding(
  id: string,
  reviewId: string,
  overrides: Partial<FindingRecord> = {},
): FindingRecord {
  return {
    id,
    review_id: reviewId,
    severity: "WARNING",
    category: "bug",
    title: id,
    file: "src/core.ts",
    start_line: 10,
    end_line: 10,
    rationale: "Rationale",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
    ...overrides,
  };
}

function review(
  id: string,
  agentId: string | null,
  createdAt: string,
  findings: FindingRecord[],
  overrides: Partial<ReviewRecord> = {},
): ReviewRecord {
  return {
    id,
    pr_id: "pr-1",
    agent_id: agentId,
    run_id: `run-${id}`,
    agent_name: agentId,
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 80,
    model: "test",
    grounding: null,
    created_at: createdAt,
    findings,
    ...overrides,
  };
}

const GROUPS: SmartDiffGroup[] = [
  {
    role: "core",
    files: [
      {
        path: "src/core.ts",
        additions: 2,
        deletions: 0,
        pseudocode_summary: null,
        // "old" and "stale" are deliberately absent — they must never render,
        // whether excluded upstream (superseded review) or by this id allowlist.
        line_findings: [
          { id: "fresh", line: 20, severity: "WARNING" },
          { id: "current", line: 10, severity: "WARNING" },
          { id: "warning-new", line: 10, severity: "WARNING" },
          { id: "critical-z", line: 10, severity: "CRITICAL" },
          { id: "suggestion", line: 10, severity: "SUGGESTION" },
          { id: "critical-a", line: 10, severity: "CRITICAL" },
        ],
      },
    ],
  },
];

describe("buildFileMap", () => {
  it("keys the map by path so a group file present in `files` resolves to its PrFile", () => {
    const files: PrFile[] = [
      { path: "src/core.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+core" },
      { path: "src/wiring.ts", additions: 2, deletions: 1, patch: "@@ -0,0 +1,2 @@\n+a\n+b" },
    ];

    const map = buildFileMap(files);

    expect(map.get("src/core.ts")).toEqual(files[0]);
    expect(map.get("src/wiring.ts")).toEqual(files[1]);
  });

  it("has no entry for a path that's in the group but missing from `files`, rather than an undefined entry", () => {
    const files: PrFile[] = [{ path: "src/core.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+core" }];

    const map = buildFileMap(files);

    // The stale/renamed path never made it into `files` at all.
    expect(map.has("src/renamed-away.ts")).toBe(false);
    expect(map.get("src/renamed-away.ts")).toBeUndefined();
    // The map only contains real entries — no phantom key was added for the
    // missing path, and its size matches `files`, not the group's file list.
    expect(map.size).toBe(files.length);
    expect([...map.keys()]).toEqual(["src/core.ts"]);
  });
});

describe("Smart Diff finding projection", () => {
  it("keeps only each agent's latest review findings", () => {
    const oldFinding = finding("old", "review-old");
    const freshFinding = finding("fresh", "review-fresh", { start_line: 20, end_line: 20 });
    const reviews = [
      review("review-old", "agent-a", "2026-01-01T00:00:00Z", [oldFinding]),
      review("review-fresh", "agent-a", "2026-01-02T00:00:00Z", [freshFinding]),
    ];

    const projection = projectSmartDiffFindings(GROUPS, reviews);

    expect(projection.findingsByPath.get("src/core.ts")?.get(10)).toBeUndefined();
    expect(projection.findingsByPath.get("src/core.ts")?.get(20)?.map((item) => item.id)).toEqual(["fresh"]);
  });

  it("keeps null-agent reviews independent", () => {
    const reviews = [
      review("review-a", null, "2026-01-01T00:00:00Z", [finding("a", "review-a")]),
      review("review-b", null, "2026-01-02T00:00:00Z", [finding("b", "review-b")]),
    ];

    const latest = selectLatestReviewRecords(reviews);

    expect(latest.map((item) => item.id)).toEqual(["review-a", "review-b"]);
  });

  it("keeps the first newest-first review when one agent has equal timestamps", () => {
    const reviews = [
      review("review-first", "agent-a", "2026-01-02T00:00:00Z", [finding("first", "review-first")]),
      review("review-second", "agent-a", "2026-01-02T00:00:00Z", [finding("second", "review-second")]),
    ];

    const latest = selectLatestReviewRecords(reviews);

    expect(latest.map((item) => item.id)).toEqual(["review-first"]);
  });

  it("excludes summary and dismissed findings", () => {
    const dismissed = finding("dismissed", "review-a", { dismissed_at: "2026-01-03T00:00:00Z" });
    const summaryFinding = finding("summary", "summary-review");
    const reviews = [
      review("review-a", "agent-a", "2026-01-02T00:00:00Z", [dismissed]),
      review("summary-review", "agent-b", "2026-01-02T00:00:00Z", [summaryFinding], {
        kind: "summary",
      }),
    ];

    const projection = projectSmartDiffFindings(GROUPS, reviews);

    expect(projection.findingsByPath.size).toBe(0);
    expect(projection.latestReviews.map((item) => item.id)).toEqual(["review-a"]);
  });

  it("intersects records with authoritative line_findings ids", () => {
    const stale = finding("stale", "review-a", { start_line: 99, end_line: 99 });
    const current = finding("current", "review-a", { start_line: 10, end_line: 10 });

    const projection = projectSmartDiffFindings(
      GROUPS,
      [review("review-a", "agent-a", "2026-01-02T00:00:00Z", [stale, current])],
    );

    expect(projection.findingsByPath.get("src/core.ts")?.get(99)).toBeUndefined();
    expect(projection.findingsByPath.get("src/core.ts")?.get(10)?.map((item) => item.id)).toEqual(["current"]);
  });

  it("orders multiple findings on one line deterministically", () => {
    const reviews = [
      review("review-new", "agent-new", "2026-01-03T00:00:00Z", [
        finding("warning-new", "review-new"),
        finding("critical-z", "review-new", { severity: "CRITICAL" }),
      ]),
      review("review-old", "agent-old", "2026-01-02T00:00:00Z", [
        finding("suggestion", "review-old", { severity: "SUGGESTION" }),
        finding("critical-a", "review-old", { severity: "CRITICAL" }),
      ]),
    ];

    const projection = projectSmartDiffFindings(GROUPS, reviews);
    const ids = projection.findingsByPath.get("src/core.ts")?.get(10)?.map((item) => item.id);

    expect(ids).toEqual(["critical-z", "critical-a", "warning-new", "suggestion"]);
    expect(projection.findingCountByPath.get("src/core.ts")).toBe(4);
  });
});
