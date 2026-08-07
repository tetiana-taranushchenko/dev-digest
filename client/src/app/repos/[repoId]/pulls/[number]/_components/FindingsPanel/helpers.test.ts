/**
 * FindingsPanel helpers — `visibleFindings` is the pure filter+sort behind
 * both "hide low confidence" and the severity click-filter (SeverityCounters
 * → ReviewRunAccordion → FindingsPanel).
 */
import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { visibleFindings } from "./helpers";

function finding(o: Partial<FindingRecord>): FindingRecord {
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

describe("visibleFindings", () => {
  it("sorts CRITICAL, then WARNING, then SUGGESTION", () => {
    const findings = [
      finding({ id: "s", severity: "SUGGESTION" }),
      finding({ id: "c", severity: "CRITICAL" }),
      finding({ id: "w", severity: "WARNING" }),
    ];
    expect(visibleFindings(findings, false).map((f) => f.id)).toEqual(["c", "w", "s"]);
  });

  it("hides low-confidence findings only when hideLow is true", () => {
    const findings = [finding({ id: "low", confidence: 0.4 }), finding({ id: "high", confidence: 0.9 })];
    expect(visibleFindings(findings, true).map((f) => f.id)).toEqual(["high"]);
    expect(visibleFindings(findings, false).map((f) => f.id)).toEqual(["low", "high"]);
  });

  it("keeps only the selected severity when severityFilter is set", () => {
    const findings = [
      finding({ id: "c", severity: "CRITICAL" }),
      finding({ id: "w", severity: "WARNING" }),
      finding({ id: "s", severity: "SUGGESTION" }),
    ];
    expect(visibleFindings(findings, false, "WARNING").map((f) => f.id)).toEqual(["w"]);
  });

  it("shows every severity when severityFilter is null", () => {
    const findings = [finding({ id: "c", severity: "CRITICAL" }), finding({ id: "w", severity: "WARNING" })];
    expect(visibleFindings(findings, false, null)).toHaveLength(2);
  });

  it("combines hideLow and severityFilter together", () => {
    const findings = [
      finding({ id: "keep", severity: "CRITICAL", confidence: 0.9 }),
      finding({ id: "wrong-severity", severity: "WARNING", confidence: 0.9 }),
      finding({ id: "low-confidence", severity: "CRITICAL", confidence: 0.3 }),
    ];
    expect(visibleFindings(findings, true, "CRITICAL").map((f) => f.id)).toEqual(["keep"]);
  });
});
