import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EvalRunRecord } from "@devdigest/shared";
import { ToastProvider } from "../../../../lib/toast";
import type { AgentVersionSnapshot } from "./helpers";

// ---- Fixtures ---------------------------------------------------------------

function runRecord(overrides: Partial<EvalRunRecord> = {}): EvalRunRecord {
  return {
    id: "run-1",
    case_id: "case-1",
    case_name: null,
    ran_at: "2026-05-27T00:00:00.000Z",
    actual_output: null,
    pass: true,
    recall: 0.7,
    precision: 0.9,
    citation_accuracy: 0.9,
    duration_ms: 800,
    cost_usd: 0.04,
    ...overrides,
  };
}

const OLD_RUN = runRecord({ id: "run-old", ran_at: "2026-05-27T00:00:00.000Z" });
const NEW_RUN = runRecord({
  id: "run-new",
  ran_at: "2026-05-29T09:14:00.000Z",
  recall: 0.82,
  precision: 0.91,
  citation_accuracy: 0.95,
  cost_usd: 0.05,
});

function versionSnapshot(overrides: Partial<AgentVersionSnapshot> = {}): AgentVersionSnapshot {
  return {
    agent_id: "ag1",
    version: 1,
    config: {
      provider: "openai",
      model: "gpt-4.1",
      system_prompt: "Check for security and style bugs.",
      output_schema: null,
      strategy: "single-pass",
      ci_fail_on: "critical",
      repo_intel: true,
      skills: ["sk1", "sk2"],
    },
    created_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

const OLD_SNAPSHOT = versionSnapshot({ version: 1, created_at: "2026-05-01T00:00:00.000Z" });
const NEW_SNAPSHOT = versionSnapshot({
  version: 2,
  created_at: "2026-05-28T00:00:00.000Z",
  config: { ...OLD_SNAPSHOT.config, system_prompt: "Check for security and performance bugs.", skills: ["sk1", "sk3"] },
});
const VERSIONS = [OLD_SNAPSHOT, NEW_SNAPSHOT];

// ---- Mocks --------------------------------------------------------------

const updateAgentMutateAsync = vi.fn();
const setSkillsMutateAsync = vi.fn();
const callOrder: string[] = [];

vi.mock("../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutateAsync: updateAgentMutateAsync }),
  useSetAgentSkills: () => ({ mutateAsync: setSkillsMutateAsync }),
}));

import { CompareRunsModal } from "./CompareRunsModal";

function renderModal(runs: [EvalRunRecord, EvalRunRecord] = [OLD_RUN, NEW_RUN], versions = VERSIONS) {
  return render(
    <ToastProvider>
      <CompareRunsModal runs={runs} versions={versions} onClose={vi.fn()} />
    </ToastProvider>,
  );
}

afterEach(() => {
  cleanup();
  updateAgentMutateAsync.mockReset();
  setSkillsMutateAsync.mockReset();
  callOrder.length = 0;
});

describe("CompareRunsModal", () => {
  it("shows old→new deltas for Recall/Precision/Citation/Cost and a system-prompt diff from the two matched agent version snapshots", () => {
    renderModal();

    // Title names both matched versions.
    expect(screen.getByText("Compare runs · v1 → v2")).toBeInTheDocument();

    // Recall 70% -> 82%, a +12pt delta.
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("82%")).toBeInTheDocument();
    expect(screen.getByText("▲ 12pt")).toBeInTheDocument();

    // Precision 90% -> 91%, Citation 90% -> 95%.
    expect(screen.getByText("91%")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();

    // Cost $0.0400 -> $0.0500.
    expect(screen.getByText("$0.0400")).toBeInTheDocument();
    expect(screen.getByText("$0.0500")).toBeInTheDocument();

    // System-prompt diff — a removed-only word (old snapshot) and an
    // added-only word (new snapshot) from the two config snapshots.
    expect(screen.getByText("style")).toBeInTheDocument();
    expect(screen.getByText("performance")).toBeInTheDocument();
  });

  it("Promote asks for confirmation then calls PUT /agents/:id with the version config followed by POST /agents/:id/skills with its skill list", async () => {
    updateAgentMutateAsync.mockImplementation(async () => {
      callOrder.push("put");
      return { id: "ag1" };
    });
    setSkillsMutateAsync.mockImplementation(async () => {
      callOrder.push("post-skills");
      return [];
    });

    renderModal();

    // Activating Promote asks for confirmation first — neither call fires yet.
    fireEvent.click(screen.getByRole("button", { name: "Promote v2" }));
    expect(updateAgentMutateAsync).not.toHaveBeenCalled();
    expect(setSkillsMutateAsync).not.toHaveBeenCalled();
    const confirmMessage = screen.getByText("Promote this version?");
    expect(confirmMessage).toBeInTheDocument();

    // Confirming issues the PUT with the newer snapshot's config, then the
    // POST with its skill list — in that order. Scoped to the confirm
    // dialog since the underlying modal's own footer button shares the
    // same "Promote v2" label.
    const confirmDialog = confirmMessage.closest('[role="dialog"]') as HTMLElement;
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Promote v2" }));

    await waitFor(() => expect(setSkillsMutateAsync).toHaveBeenCalled());

    expect(updateAgentMutateAsync).toHaveBeenCalledWith({
      id: "ag1",
      patch: {
        provider: "openai",
        model: "gpt-4.1",
        system_prompt: "Check for security and performance bugs.",
        output_schema: null,
        strategy: "single-pass",
        ci_fail_on: "critical",
        repo_intel: true,
      },
    });
    expect(setSkillsMutateAsync).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk1", "sk3"] });
    expect(callOrder).toEqual(["put", "post-skills"]);

    // A single combined success state.
    expect(await screen.findByText("Promoted v2 to current.")).toBeInTheDocument();
  });
});
