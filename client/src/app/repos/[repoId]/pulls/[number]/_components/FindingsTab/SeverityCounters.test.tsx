import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { SeverityCounters } from "./SeverityCounters";

afterEach(cleanup);

function finding(severity: Severity, dismissed = false): FindingRecord {
  return {
    id: Math.random().toString(36),
    severity,
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
    dismissed_at: dismissed ? "2026-06-01T00:00:00.000Z" : null,
  };
}

describe("SeverityCounters", () => {
  it("counts findings per severity, excluding dismissed ones", () => {
    const findings = [
      finding("CRITICAL"),
      finding("CRITICAL"),
      finding("CRITICAL", true), // dismissed — should not count
      finding("WARNING"),
    ];
    render(<SeverityCounters findings={findings} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: /CRITICAL/i })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /WARNING/i })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /SUGGESTION/i })).toHaveTextContent("0");
  });

  it("clicking a severity selects it", () => {
    const onSelect = vi.fn();
    render(<SeverityCounters findings={[finding("CRITICAL")]} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /CRITICAL/i }));
    expect(onSelect).toHaveBeenCalledWith("CRITICAL");
  });

  it("clicking the already-selected severity clears the filter", () => {
    const onSelect = vi.fn();
    render(<SeverityCounters findings={[finding("CRITICAL")]} selected="CRITICAL" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /CRITICAL/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});
