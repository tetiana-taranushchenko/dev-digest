/**
 * RunHistory — the badge must reflect the review OUTCOME, not the run lifecycle.
 * Regression guard for the "green ✓ done on a run that found 5 blockers" bug:
 * a settled run is colored/labelled by its denormalized blocker/finding counts,
 * and shows the review score ring.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunSummary, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { RunHistory } from "./RunHistory";

afterEach(cleanup);

function run(o: Partial<RunSummary>): RunSummary {
  return {
    run_id: "run-1",
    agent_id: "a1",
    agent_name: "Security Reviewer",
    provider: "openrouter",
    model: "deepseek/deepseek-v4-flash",
    status: "done",
    error: null,
    duration_ms: 1000,
    tokens_in: 100,
    tokens_out: 50,
    cost_usd: 0.001,
    findings_count: 0,
    grounding: "0/0 passed",
    ran_at: "2026-06-11T18:44:34.000Z",
    score: null,
    blockers: null,
    ...o,
  };
}

function finding(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Leaked secret",
    file: "src/a.ts",
    start_line: 1,
    end_line: 1,
    rationale: "A secret is committed.",
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

function renderRuns(runs: RunSummary[], findingsByRunId?: Map<string, FindingRecord[]>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <RunHistory runs={runs} findingsByRunId={findingsByRunId} onOpenTrace={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("RunHistory — outcome badge", () => {
  it("a done run WITH blockers reads 'rejected' (never green 'done') + shows the score ring", () => {
    renderRuns([run({ status: "done", findings_count: 5, blockers: 5, score: 0 })]);
    expect(screen.getByText("rejected")).toBeInTheDocument();
    expect(screen.queryByText("done")).not.toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument(); // CircularScore renders the number
    expect(screen.getByText(/5 blockers/)).toBeInTheDocument();
  });

  it("a clean done run reads 'approved'", () => {
    renderRuns([run({ status: "done", findings_count: 0, blockers: 0, score: 95 })]);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("95")).toBeInTheDocument();
  });

  it("a done run with non-blocking findings reads 'reviewed'", () => {
    renderRuns([run({ status: "done", findings_count: 3, blockers: 0, score: 72 })]);
    expect(screen.getByText("reviewed")).toBeInTheDocument();
    expect(screen.queryByText(/blockers/)).not.toBeInTheDocument();
  });

  it("a failed run reads 'error'", () => {
    renderRuns([run({ status: "failed", error: "boom", score: null, blockers: null })]);
    expect(screen.getByText("error")).toBeInTheDocument();
  });

  it("a running run reads 'running'", () => {
    renderRuns([run({ status: "running", score: null, blockers: null })]);
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});

describe("RunHistory — findings summary", () => {
  it("falls back to plain 'N findings · M blockers' text when no findings data is available for the run", () => {
    renderRuns([run({ findings_count: 2, blockers: 1 })]);
    expect(screen.getByText(/2 findings/)).toBeInTheDocument();
    expect(screen.getByText(/1 blockers/)).toBeInTheDocument();
  });

  it("shows severity badges (not the plain text) when the run's findings are available", () => {
    renderRuns(
      [run({ run_id: "run-1", findings_count: 1, blockers: 1 })],
      new Map([["run-1", [finding({})]]]),
    );
    expect(screen.queryByText(/1 findings/)).not.toBeInTheDocument();
    // SeverityBadge is `compact` here (icon + count, no label) — its count is the
    // one unambiguous piece of visible text this run's summary renders.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("hovering the severity badges opens a popup listing that run's findings", () => {
    renderRuns(
      [run({ run_id: "run-1", findings_count: 1, blockers: 1 })],
      new Map([["run-1", [finding({ title: "Leaked secret" })]]]),
    );
    fireEvent.mouseEnter(screen.getByText("1").closest("div")!);
    expect(screen.getByText("Leaked secret")).toBeInTheDocument();
  });
});
