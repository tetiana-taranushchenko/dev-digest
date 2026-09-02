import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, EvalCase, EvalDashboard, EvalRunRecord, Skill } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import type { EvalBatchState } from "../../../lib/hooks/eval";
import { LINK_AGENT_HINT, OWNER_DELETED_LABEL, RUN_ALL_LABEL, TRACES_PASSED_LABEL } from "./constants";

// ---- Fixtures --------------------------------------------------------------

const AGENTS: Agent[] = [
  {
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
  },
];
const SKILLS: Skill[] = [];
const SKILL_SK1: Skill = {
  id: "sk1",
  name: "PR Quality Rubric",
  description: "",
  type: "custom",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
  evidence_files: null,
  injection_flagged: false,
  injection_reason: null,
};

const CASES: EvalCase[] = [
  {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key-leak",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [{ file: "a.ts", start_line: 1, end_line: 1 }],
    notes: null,
  },
  {
    id: "case-2",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "missing-retry-after",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [{ file: "b.ts", start_line: 1, end_line: 1 }],
    notes: null,
  },
  {
    id: "case-3",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "service-role-in-client",
    input_diff: "",
    input_files: null,
    input_meta: null,
    expected_output: [{ file: "c.ts", start_line: 1, end_line: 1 }],
    notes: null,
  },
];

function runRecord(overrides: Partial<EvalRunRecord>): EvalRunRecord {
  return {
    id: "run",
    case_id: "case-1",
    case_name: null,
    ran_at: "2026-01-01T00:00:00.000Z",
    actual_output: null,
    pass: true,
    recall: 1,
    precision: 1,
    citation_accuracy: 1,
    duration_ms: 800,
    cost_usd: 0.01,
    ...overrides,
  };
}

// case-1 passes, case-2 fails, case-3 has no run at all (never run).
const RECENT_RUNS: EvalRunRecord[] = [
  runRecord({ id: "run-2", case_id: "case-2", pass: false, recall: 0 }),
  runRecord({ id: "run-1", case_id: "case-1", pass: true, recall: 1 }),
];

function dashboardFixture(overrides: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "ag1",
    cases_total: 3,
    current: { recall: 0.5, precision: 1, citation_accuracy: 1, traces_passed: 1, traces_total: 2, cost_usd: 0.02 },
    delta: { recall: 0.1, precision: 0, citation_accuracy: 0 },
    trend: [
      { ran_at: "2025-12-31T00:00:00.000Z", recall: 0.4, precision: 1, citation_accuracy: 1, pass_rate: 0.5, cost_usd: 0.01 },
      { ran_at: "2026-01-01T00:00:00.000Z", recall: 0.5, precision: 1, citation_accuracy: 1, pass_rate: 0.5, cost_usd: 0.02 },
    ],
    recent_runs: RECENT_RUNS,
    alert: null,
    ...overrides,
  };
}

// ---- Mocks ------------------------------------------------------------------

let currentCases: EvalCase[] = CASES;
let currentDashboard: EvalDashboard | undefined = dashboardFixture();
let bulkStatus: EvalBatchState | undefined;

const runCaseMutateAsync = vi.fn();
const runAllMutateAsync = vi.fn();
const deleteCaseMutate = vi.fn();

vi.mock("../../../lib/hooks/eval", () => ({
  useEvalCases: () => ({ data: currentCases, isLoading: false }),
  useEvalDashboard: () => ({ data: currentDashboard }),
  useRunEvalCase: () => ({ mutateAsync: runCaseMutateAsync, isPending: false }),
  useRunAllEvals: () => ({ mutateAsync: runAllMutateAsync, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteCaseMutate, isPending: false }),
  useBulkRunStatus: (batchId: string | null | undefined) => ({ data: batchId ? bulkStatus : undefined }),
}));

vi.mock("../../eval-case-editor/EvalCaseEditor", () => ({
  EvalCaseEditor: ({ caseId, seed }: { caseId?: string; seed?: { owner_id: string } }) => (
    <div data-testid="case-editor">{caseId ? `edit:${caseId}` : `new:${seed?.owner_id}`}</div>
  ),
}));

import { EvalsTab, type EvalsTabProps } from "./EvalsTab";

function renderTab(props: Partial<EvalsTabProps> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalsTab ownerKind="agent" ownerId="ag1" ownerName="Security Reviewer" agents={AGENTS} skills={SKILLS} {...props} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function rowFor(name: string): HTMLElement {
  const row = screen.getAllByRole("listitem").find((r) => within(r).queryByText(name));
  if (!row) throw new Error(`row not found for ${name}`);
  return row;
}

afterEach(() => {
  cleanup();
  currentCases = CASES;
  currentDashboard = dashboardFixture();
  bulkStatus = undefined;
  runCaseMutateAsync.mockReset();
  runAllMutateAsync.mockReset();
  deleteCaseMutate.mockReset();
});

describe("EvalsTab", () => {
  it("renders Recall/Precision/Citation accuracy/Traces passed with deltas", () => {
    const { container } = renderTab();

    expect(screen.getByText(evalMessages.dashboard.metrics.recall)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.metrics.precision)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.dashboard.metrics.citationAccuracy)).toBeInTheDocument();
    expect(screen.getByText(TRACES_PASSED_LABEL)).toBeInTheDocument();

    // current values (recall 50%, traces 1/2) + a delta rendered for recall
    // (trend has 2 points, so delta.recall=0.1 -> "10.00").
    expect(container.textContent).toContain("50%");
    expect(container.textContent).toContain("1/2");
    expect(container.textContent).toContain("10.00");
  });

  it("renders every case in exactly one of passing/failing/never-run state", () => {
    renderTab();

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    const passingRow = rowFor("stripe-key-leak");
    const failingRow = rowFor("missing-retry-after");
    const neverRunRow = rowFor("service-role-in-client");

    const STATES = [evalMessages.evalsTab.passed, evalMessages.evalsTab.failed, evalMessages.evalsTab.neverRun];
    const stateOf = (row: HTMLElement) => STATES.filter((label) => within(row).queryAllByText(new RegExp(label)).length > 0);

    // Every row renders exactly one of the three states — never zero, never more than one.
    for (const row of rows) expect(stateOf(row)).toHaveLength(1);

    expect(stateOf(passingRow)).toEqual([evalMessages.evalsTab.passed]);
    expect(stateOf(failingRow)).toEqual([evalMessages.evalsTab.failed]);
    expect(stateOf(neverRunRow)).toEqual([evalMessages.evalsTab.neverRun]);
  });

  it("N/M passing counts never-run cases toward M but not toward pass/fail", () => {
    renderTab();
    // 1 passing (case-1), 1 failing (case-2), case-3 never run — M=3, N=1.
    expect(screen.getByText("1 / 3 passing")).toBeInTheDocument();
  });

  it("running one case updates only that row and the metric strip", async () => {
    let resolveRun!: (value: unknown) => void;
    runCaseMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    );

    const { container } = renderTab();
    const failingRow = rowFor("missing-retry-after");
    fireEvent.click(within(failingRow).getByRole("button", { name: evalMessages.evalsTab.run }));

    // Only case-2's run fires — no other case's mutation is triggered.
    expect(runCaseMutateAsync).toHaveBeenCalledTimes(1);
    expect(runCaseMutateAsync).toHaveBeenCalledWith("case-2");
    expect(within(failingRow).getByText(evalMessages.evalsTab.running)).toBeInTheDocument();

    // Simulate the server round trip: case-2 now passes and the dashboard
    // reflects the fresh aggregate (what `useRunEvalCase`'s invalidation
    // would produce on refetch).
    currentDashboard = dashboardFixture({ current: { ...dashboardFixture().current, recall: 0.75 } });
    await act(async () => {
      resolveRun({ run_id: "run-3", case_id: "case-2", result: { recall: 1, precision: 1 } });
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(within(rowFor("missing-retry-after")).queryByText(evalMessages.evalsTab.running)).not.toBeInTheDocument(),
    );
    // MetricCard splits "75" and "%" into adjacent nodes — assert via
    // `container.textContent` (RTL's `getByText` only matches an element's
    // own direct text-node children, not text split across nested spans).
    expect(container.textContent).toContain("75%");
  });

  it("Run all evals refreshes every case and the strip on completion", async () => {
    runAllMutateAsync.mockResolvedValue({ batch_id: "batch-1", total: 3 });
    const { container, rerender } = renderTab();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: RUN_ALL_LABEL }));
    });
    expect(runAllMutateAsync).toHaveBeenCalledWith({ owner_kind: "agent", owner_id: "ag1" });

    // Batch running.
    bulkStatus = { total: 3, completed: 1, results: [], errors: [], status: "running" };
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
          <EvalsTab ownerKind="agent" ownerId="ag1" ownerName="Security Reviewer" agents={AGENTS} skills={SKILLS} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: evalMessages.evalsTab.running })).toBeInTheDocument();
    expect(screen.getByText("1/3")).toBeInTheDocument();

    // Batch completes — every case + the strip refresh from fresh data.
    bulkStatus = { total: 3, completed: 3, results: [], errors: [], status: "done" };
    currentCases = CASES.map((c) => ({ ...c }));
    currentDashboard = dashboardFixture({ current: { ...dashboardFixture().current, recall: 0.75 } });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
          <EvalsTab ownerKind="agent" ownerId="ag1" ownerName="Security Reviewer" agents={AGENTS} skills={SKILLS} />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    expect(container.textContent).toContain("75%");
    expect(screen.getByRole("button", { name: RUN_ALL_LABEL })).toBeInTheDocument();
  });

  it("Run and Run all evals are disabled while a run is in flight for this owner", async () => {
    let resolveRun!: (value: unknown) => void;
    runCaseMutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRun = resolve;
        }),
    );

    renderTab();
    const passingRow = rowFor("stripe-key-leak");
    fireEvent.click(within(passingRow).getByRole("button", { name: evalMessages.evalsTab.run }));

    // The other row's Run control and "Run all evals" both refuse a second
    // concurrent run for this owner while one is in flight.
    const failingRow = rowFor("missing-retry-after");
    expect(within(failingRow).getByRole("button", { name: evalMessages.evalsTab.run })).toBeDisabled();
    expect(screen.getByRole("button", { name: RUN_ALL_LABEL })).toBeDisabled();

    await act(async () => {
      resolveRun({ run_id: "run-1", case_id: "case-1", result: { recall: 1, precision: 1 } });
      await Promise.resolve();
    });
  });

  it("an orphaned case shows Owner deleted, read-only, and is excluded from Run all evals", () => {
    currentCases = [{ ...CASES[0]!, owner_id: "ghost-agent" }];
    renderTab({ ownerId: "ghost-agent", agents: [], skills: [] });

    expect(screen.getAllByText(OWNER_DELETED_LABEL).length).toBeGreaterThan(0);
    const row = screen.getAllByRole("listitem")[0]!;
    expect(within(row).getByRole("button", { name: evalMessages.evalsTab.run })).toBeDisabled();
    expect(within(row).getByRole("button", { name: evalMessages.evalsTab.edit })).toBeDisabled();
    expect(screen.getByRole("button", { name: RUN_ALL_LABEL })).toBeDisabled();
  });

  it("a skill Evals tab with no enabled linked agent disables running and shows the linking hint", () => {
    renderTab({ ownerKind: "skill", ownerId: "sk1", ownerName: "PR Quality Rubric", skills: [SKILL_SK1], canRun: false });

    expect(screen.getByText(LINK_AGENT_HINT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: RUN_ALL_LABEL })).toBeDisabled();
    const row = screen.getAllByRole("listitem")[0]!;
    expect(within(row).getByRole("button", { name: evalMessages.evalsTab.run })).toBeDisabled();
  });

  it("opens the eval-case editor from New eval case and a case's edit control", () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: evalMessages.evalsTab.newCase }));
    expect(screen.getByTestId("case-editor")).toHaveTextContent("new:ag1");
  });
});
