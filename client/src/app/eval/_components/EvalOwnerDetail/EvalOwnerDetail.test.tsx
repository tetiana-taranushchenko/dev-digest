import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import type { AgentVersionSnapshot } from "./helpers";
import { COMPARE_LABEL, SELECT_TWO_HINT } from "./constants";

// ---- Fixtures ---------------------------------------------------------------

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function runRecord(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run-1",
    case_id: "case-1",
    case_name: null,
    ran_at: "2026-05-29T09:14:00.000Z",
    actual_output: null,
    pass: true,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    duration_ms: 800,
    cost_usd: 0.05,
    ...overrides,
  };
}

function dashboardFixture(overrides: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "ag1",
    cases_total: 3,
    current: { recall: 0.82, precision: 0.91, citation_accuracy: 0.95, traces_passed: 2, traces_total: 3, cost_usd: 0.05 },
    delta: { recall: 0.05, precision: -0.02, citation_accuracy: 0.01 },
    trend: [
      { ran_at: "2026-05-27T00:00:00.000Z", recall: 0.7, precision: 0.9, citation_accuracy: 0.9, pass_rate: 0.5, cost_usd: 0.04 },
      { ran_at: "2026-05-29T09:14:00.000Z", recall: 0.82, precision: 0.91, citation_accuracy: 0.95, pass_rate: 0.66, cost_usd: 0.05 },
    ],
    recent_runs: [
      runRecord({ id: "run-2", ran_at: "2026-05-29T09:14:00.000Z" }),
      runRecord({ id: "run-1", ran_at: "2026-05-27T00:00:00.000Z", recall: 0.7 }),
    ],
    alert: null,
    ...overrides,
  };
}

const versionConfig = {
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  skills: [] as string[],
};

const VERSIONS: AgentVersionSnapshot[] = [
  { agent_id: "ag1", version: 1, config: versionConfig, created_at: "2026-05-01T00:00:00.000Z" },
  { agent_id: "ag1", version: 2, config: versionConfig, created_at: "2026-05-28T00:00:00.000Z" },
];

// ---- Mocks ------------------------------------------------------------------

let dashboard: EvalDashboard | undefined;
let versions: AgentVersionSnapshot[] | undefined;

vi.mock("../../../../lib/hooks/eval", () => ({
  useEvalDashboard: () => ({ data: dashboard, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock("../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [AGENT], isLoading: false }),
}));

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: [], isLoading: false }),
}));

vi.mock("./useOwnerAgentVersions", () => ({
  useOwnerAgentVersions: () => ({ data: versions }),
}));

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EvalOwnerDetail } from "./EvalOwnerDetail";

function renderDetail() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <EvalOwnerDetail ownerKind="agent" ownerId="ag1" onBack={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

/** The recent-runs table's data rows are the only `listitem`s this tree
 *  renders (the header row uses `role="presentation"`) — filter defensively
 *  by "has a checkbox" so this stays robust if that ever changes. */
function runRows() {
  return screen.getAllByRole("listitem").filter((row) => within(row).queryByRole("checkbox"));
}

/** `noUncheckedIndexedAccess` makes `rows[n]` type as `HTMLElement | undefined`
 *  — this asserts presence (failing loudly if a fixture/selector regresses)
 *  and hands back a narrowed `HTMLElement` for RTL calls that require one. */
function getRow(rows: HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (!row) throw new Error(`Expected a run row at index ${index}, got ${rows.length} rows`);
  return row;
}

afterEach(() => {
  cleanup();
  dashboard = undefined;
  versions = undefined;
});

describe("EvalOwnerDetail", () => {
  it("renders the alert banner only when alert is non-null", () => {
    dashboard = dashboardFixture({ alert: null });
    versions = VERSIONS;
    renderDetail();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    cleanup();

    dashboard = dashboardFixture({ alert: "Precision dipped 8pts on v2 — a new false positive slipped in." });
    versions = VERSIONS;
    renderDetail();
    expect(screen.getByRole("alert")).toHaveTextContent("Precision dipped 8pts on v2");
  });

  it("renders a metric card with delta+sparkline per metric plus the trend chart and recent-runs table", () => {
    dashboard = dashboardFixture();
    versions = VERSIONS;
    const { container } = renderDetail();

    // One metric card per metric, each with its current value and delta.
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument(); // recall value (pct)
    expect(screen.getByText("5.00")).toBeInTheDocument(); // recall delta (deltaPct(0.05))

    // Each card's sparkline (`trend` prop present -> vendored MetricCard
    // renders a Sparkline) plus the standalone trend LineChart both render
    // an svg — the observable proxy for "a chart is drawn" in jsdom.
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);

    // The metric trend chart, with its legend. Scoped via `within` because
    // the legend's item labels are byte-identical to the recent-runs
    // table's column headers rendered lower on the same page (both say
    // "Recall"/"Citation" — see `dashboard.legend.*` vs `dashboard.table.*`
    // in messages/en/eval.json).
    expect(screen.getByText("Metric trend")).toBeInTheDocument();
    const legend = within(screen.getByTestId("trend-legend"));
    expect(legend.getByText("Recall")).toBeInTheDocument();
    expect(legend.getByText("Citation")).toBeInTheDocument();

    // The recent-runs table — one row per `recent_runs` entry.
    expect(screen.getByText("Recent runs")).toBeInTheDocument();
    expect(runRows()).toHaveLength(2);
  });

  it("Compare enables only when exactly two runs are selected, else shows the hint", () => {
    dashboard = dashboardFixture();
    versions = VERSIONS;
    renderDetail();

    expect(screen.getByText(SELECT_TWO_HINT)).toBeInTheDocument();
    const compareButton = screen.getByRole("button", { name: COMPARE_LABEL });
    expect(compareButton).toBeDisabled();

    const rows = runRows();
    expect(rows).toHaveLength(2);

    fireEvent.click(getRow(rows, 0));
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(compareButton).toBeDisabled();

    fireEvent.click(getRow(rows, 1));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(compareButton).toBeEnabled();
  });

  it("each recent-run row shows a version label inferred from ran_at vs agent_versions", () => {
    dashboard = dashboardFixture({
      recent_runs: [
        runRecord({ id: "run-before-v1", ran_at: "2026-04-15T00:00:00.000Z" }), // before v1 -> none
        runRecord({ id: "run-on-v1", ran_at: "2026-05-15T00:00:00.000Z" }), // after v1, before v2 -> v1
        runRecord({ id: "run-on-v2", ran_at: "2026-06-01T00:00:00.000Z" }), // after v2 -> v2
      ],
    });
    versions = VERSIONS; // v1 created 2026-05-01, v2 created 2026-05-28
    renderDetail();

    const rows = runRows();
    expect(rows).toHaveLength(3);
    expect(within(getRow(rows, 0)).getByText("—")).toBeInTheDocument();
    expect(within(getRow(rows, 1)).getByText("v1")).toBeInTheDocument();
    expect(within(getRow(rows, 2)).getByText("v2")).toBeInTheDocument();
  });
});
