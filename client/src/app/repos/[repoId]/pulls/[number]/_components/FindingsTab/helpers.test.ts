/**
 * groupFindingsByRun — flattens review runs into one findings list (for
 * SeverityCounters) and indexes them by run_id (for the Timeline's per-run
 * hover popup). Pulled out of FindingsTab so it's testable without mounting
 * the component.
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

  it("flattens every run's findings into allFindings", () => {
    const f1 = finding({ id: "f1" });
    const f2 = finding({ id: "f2" });
    const f3 = finding({ id: "f3" });
    const { allFindings } = groupFindingsByRun([
      review({ run_id: "run-1", findings: [f1, f2] }),
      review({ run_id: "run-2", findings: [f3] }),
    ]);
    expect(allFindings.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
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
