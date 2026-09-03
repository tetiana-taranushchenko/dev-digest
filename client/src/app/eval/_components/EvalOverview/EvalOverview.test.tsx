import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import type { Agent, EvalDashboard, EvalRunRecord, Skill } from "@devdigest/shared";
import evalMessages from "../../../../../messages/en/eval.json";
import type { EvalBatchState } from "../../../../lib/hooks/eval";
import { formatRanAt } from "./helpers";
import { runAllConfirmMessage, RUN_ALL_AGENTS_LABEL, RUN_ALL_CONFIRM_TITLE } from "./constants";

// ---- Fixtures ---------------------------------------------------------------

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

const SKILLS: Skill[] = [
  {
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
  },
];

function runRecord(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run",
    case_id: "case-1",
    case_name: null,
    ran_at: "2026-05-29T09:14:00.000Z",
    actual_output: null,
    pass: true,
    recall: 0.82,
    precision: 0.91,
    citation_accuracy: 0.95,
    duration_ms: 800,
    cost_usd: 0.01,
    ...overrides,
  };
}

function dashboardFixture(overrides: Partial<EvalDashboard>): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: "ag1",
    cases_total: 3,
    current: { recall: 0.82, precision: 0.91, citation_accuracy: 0.95, traces_passed: 2, traces_total: 3, cost_usd: 0.01 },
    delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    trend: [
      { ran_at: "2026-05-28T00:00:00.000Z", recall: 0.7, precision: 0.9, citation_accuracy: 0.9, pass_rate: 0.5, cost_usd: 0.01 },
      { ran_at: "2026-05-29T09:14:00.000Z", recall: 0.82, precision: 0.91, citation_accuracy: 0.95, pass_rate: 0.66, cost_usd: 0.01 },
    ],
    recent_runs: [runRecord()],
    alert: null,
    ...overrides,
  };
}

// case totals: ag1=3, sk1=2, ghost(orphaned agent)=5 -> runnable total = 5.
const OVERVIEW: EvalDashboard[] = [
  dashboardFixture({ owner_kind: "agent", owner_id: "ag1", cases_total: 3 }),
  dashboardFixture({
    owner_kind: "skill",
    owner_id: "sk1",
    cases_total: 2,
    current: { recall: 0.74, precision: 0.88, citation_accuracy: 0.9, traces_passed: 1, traces_total: 2, cost_usd: 0.02 },
    recent_runs: [runRecord({ ran_at: "2026-05-28T13:20:00.000Z", recall: 0.74, precision: 0.88, citation_accuracy: 0.9 })],
  }),
  dashboardFixture({
    owner_kind: "agent",
    owner_id: "ghost",
    cases_total: 5,
    current: { recall: 0.5, precision: 0.5, citation_accuracy: 0.5, traces_passed: 0, traces_total: 0, cost_usd: null },
    recent_runs: [],
    trend: [],
  }),
];

// ---- Mocks ------------------------------------------------------------------

let bulkStatus: EvalBatchState | undefined;
const runAllMutateAsync = vi.fn();

vi.mock("../../../../lib/hooks/eval", () => ({
  useEvalOverview: () => ({ data: OVERVIEW, isLoading: false, isError: false, refetch: vi.fn() }),
  useRunAllEvals: () => ({ mutateAsync: runAllMutateAsync, isPending: false }),
  useBulkRunStatus: (batchId: string | null | undefined) => ({ data: batchId ? bulkStatus : undefined }),
}));

vi.mock("../../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS, isLoading: false }),
}));

vi.mock("../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false }),
}));

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { EvalOverview } from "./EvalOverview";

function renderOverview() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalOverview />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  bulkStatus = undefined;
  runAllMutateAsync.mockReset();
});

describe("EvalOverview", () => {
  it("renders one row per owner with latest run timestamp, pass count, and Recall/Precision/Citation", () => {
    renderOverview();

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);

    const agentRow = rows.find((r) => within(r).queryByText("Security Reviewer"));
    const skillRow = rows.find((r) => within(r).queryByText("PR Quality Rubric"));
    if (!agentRow || !skillRow) throw new Error("expected an agent row and a skill row");

    // Latest run timestamp + pass count (both live in the same "meta" text
    // node alongside the kind/model labels — match by substring via regex,
    // same reasoning `EvalsTab.test.tsx` documents for its own summary line).
    const escape = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(within(agentRow).getByText(new RegExp(escape(formatRanAt("2026-05-29T09:14:00.000Z")!)))).toBeInTheDocument();
    expect(within(agentRow).getByText(/2\/3 pass/)).toBeInTheDocument();

    // Recall / Precision / Citation.
    expect(within(agentRow).getByText("82%")).toBeInTheDocument();
    expect(within(agentRow).getByText("91%")).toBeInTheDocument();
    expect(within(agentRow).getByText("95%")).toBeInTheDocument();

    expect(within(skillRow).getByText(/1\/2 pass/)).toBeInTheDocument();
    expect(within(skillRow).getByText("74%")).toBeInTheDocument();

    // AC-39 — the orphaned owner is still shown (read-only), not hidden.
    expect(screen.getByText("Owner deleted")).toBeInTheDocument();
  });

  it("Run all agents shows a confirmation naming the total case/LLM-call count before firing", async () => {
    runAllMutateAsync.mockResolvedValue({ batch_id: "batch-1", total: 5 });
    renderOverview();

    fireEvent.click(screen.getByRole("button", { name: RUN_ALL_AGENTS_LABEL }));

    // Confirmation appears before anything fires — excludes the orphaned
    // owner's 5 cases from the count (AC-39): 3 (agent) + 2 (skill) = 5.
    expect(runAllMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(RUN_ALL_CONFIRM_TITLE)).toBeInTheDocument();
    expect(screen.getByText(runAllConfirmMessage(5))).toBeInTheDocument();

    const dialog = screen.getByRole("dialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: RUN_ALL_AGENTS_LABEL }));
    });

    expect(runAllMutateAsync).toHaveBeenCalledWith({});
  });
});
