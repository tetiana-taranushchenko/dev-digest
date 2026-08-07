/**
 * groupFindingsByRun — builds the severity counters' source list (each
 * agent's LATEST review only) and indexes every run's own findings by
 * run_id (for the Timeline's per-run hover popup). Pulled out of
 * FindingsTab so it's testable without mounting the component.
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import { groupFindingsByRun } from "./helpers";

function finding(o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "WARNING",
    category: "bug",
    title: "A finding",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "Because.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(o: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "r1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run-1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "approve",
    summary: "Looks good.",
    score: 90,
    model: "gpt-4.1",
    grounding: null,
    created_at: "2026-06-11T00:00:00.000Z",
    findings: [],
    ...o,
  };
}

describe("groupFindingsByRun", () => {
  it("is empty for no runs", () => {
    expect(groupFindingsByRun([])).toEqual({ allFindings: [], findingsByRunId: new Map() });
  });

  it("allFindings includes every distinct agent's findings", () => {
    const f1 = finding({ id: "f1" });
    const f2 = finding({ id: "f2" });
    const { allFindings } = groupFindingsByRun([
      review({ run_id: "run-1", agent_id: "security", findings: [f1] }),
      review({ run_id: "run-2", agent_id: "performance", findings: [f2] }),
    ]);
    expect(allFindings.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("allFindings only counts each agent's LATEST review, not older re-runs", () => {
    const stale = finding({ id: "stale" });
    const current = finding({ id: "current" });
    const { allFindings } = groupFindingsByRun([
      review({
        run_id: "run-old",
        agent_id: "security",
        created_at: "2026-06-01T00:00:00.000Z",
        findings: [stale],
      }),
      review({
        run_id: "run-new",
        agent_id: "security",
        created_at: "2026-06-11T00:00:00.000Z",
        findings: [current],
      }),
    ]);
    expect(allFindings.map((f) => f.id)).toEqual(["current"]);
  });

  it("findingsByRunId still keeps every run's own findings, even the superseded ones", () => {
    const stale = finding({ id: "stale" });
    const current = finding({ id: "current" });
    const { findingsByRunId } = groupFindingsByRun([
      review({ run_id: "run-old", agent_id: "security", created_at: "2026-06-01T00:00:00.000Z", findings: [stale] }),
      review({
        run_id: "run-new",
        agent_id: "security",
        created_at: "2026-06-11T00:00:00.000Z",
        findings: [current],
      }),
    ]);
    expect(findingsByRunId.get("run-old")).toEqual([stale]);
    expect(findingsByRunId.get("run-new")).toEqual([current]);
  });

  it("indexes each run's findings by its run_id", () => {
    const f1 = finding({ id: "f1" });
    const f2 = finding({ id: "f2" });
    const { findingsByRunId } = groupFindingsByRun([
      review({ run_id: "run-1", findings: [f1] }),
      review({ run_id: "run-2", findings: [f2] }),
    ]);
    expect(findingsByRunId.get("run-1")).toEqual([f1]);
    expect(findingsByRunId.get("run-2")).toEqual([f2]);
    expect(findingsByRunId.size).toBe(2);
  });

  it("still counts a run without a run_id toward allFindings, but gives it no map entry", () => {
    const f1 = finding({ id: "f1" });
    const { allFindings, findingsByRunId } = groupFindingsByRun([review({ run_id: null, findings: [f1] })]);
    expect(allFindings).toEqual([f1]);
    expect(findingsByRunId.size).toBe(0);
  });

  it("gives a run with no findings an empty (not missing) map entry", () => {
    const { findingsByRunId } = groupFindingsByRun([review({ run_id: "run-1", findings: [] })]);
    expect(findingsByRunId.has("run-1")).toBe(true);
    expect(findingsByRunId.get("run-1")).toEqual([]);
  });
});
