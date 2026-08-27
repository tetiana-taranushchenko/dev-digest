import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, AttachedContextDoc, ContextListing, Skill } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../../../lib/toast";

const FILES: ContextListing = {
  files: [
    { path: "docs/architecture.md", content: null, size: 1200, updated_at: null, source: "docs", tokens: 100, used_by: 1 },
    { path: "specs/prd.md", content: null, size: 800, updated_at: null, source: "spec", tokens: 200, used_by: 0 },
  ],
  index: { status: "done", pct: 100, message: null, chunks_indexed: 2, doc_count: 2, refreshed_at: null, unavailable_reason: null },
};

vi.mock("../../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1" }),
}));

vi.mock("../../../../../../../lib/hooks/core", () => ({
  useContextFiles: () => ({ data: FILES, isLoading: false, isError: false }),
}));

const SKILLS: Skill[] = [
  {
    id: "sk1",
    name: "Security basics",
    description: "",
    type: "security",
    source: "manual",
    body: "",
    enabled: true,
    version: 1,
    evidence_files: null,
    injection_flagged: false,
    injection_reason: null,
  },
];

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS }),
}));

const LINKS: AgentSkillLink[] = [{ agent_id: "ag1", skill_id: "sk1", order: 0 }];
const SKILL_CONTEXT: AttachedContextDoc[] = [{ path: "specs/prd.md", source: "spec", tokens: 200, resolved: true }];
const AGENT_CONTEXT: AttachedContextDoc[] = [
  { path: "docs/architecture.md", source: "docs", tokens: 100, resolved: true },
];

const setContextMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentContext: () => ({ data: AGENT_CONTEXT, isLoading: false, isError: false }),
  useAgentSkills: () => ({ data: LINKS }),
  useLinkedSkillsContext: (skillIds: string[]) =>
    skillIds.map(() => ({ data: SKILL_CONTEXT, isLoading: false, isError: false })),
  useSetAgentContext: () => ({ mutate: setContextMutate, isPending: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setContextMutate.mockClear();
});

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

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, context: contextMessages }}>
        {ui}
      </NextIntlClientProvider>
    </ToastProvider>,
  );
}

describe("ContextTab (smoke)", () => {
  it("shows the combined direct + enabled-linked-skill total (AC-10) but only persists direct paths on toggle (AC-6)", async () => {
    renderWithProviders(<ContextTab agent={AGENT} />);

    // Combined total (display-only): docs/architecture.md (direct, 100) +
    // specs/prd.md (via linked skill sk1, 200) = 300 — deduped, not
    // double-counted.
    await waitFor(() =>
      expect(screen.getByText("300 tokens total for this agent + linked skills")).toBeInTheDocument(),
    );
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    // specs/prd.md counts toward the combined total but was never a direct
    // attachment — it must not appear as an interactive/attached row.
    expect(screen.getByText("prd.md")).toBeInTheDocument();

    // Regression guard: the picker's own internal "N tokens total" summary
    // bar must be suppressed (hideSummary) now that this tab renders its
    // own combined-total bar — only ONE "tokens total"-style text should
    // ever appear, never two stacked near-identical totals.
    expect(screen.getAllByText(/tokens total/)).toHaveLength(1);

    // Toggle off the only direct attachment. The picker's own `attached`
    // prop is direct-only, so this must NOT resurrect the inherited-only
    // specs/prd.md into the persisted set (the bug this test guards
    // against: it previously leaked every inherited path into `paths` on
    // any direct edit).
    const row = screen.getByText("architecture.md").closest("div")!;
    const checkbox = row.querySelector('[role="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(setContextMutate).toHaveBeenCalledTimes(1);
    const [args] = setContextMutate.mock.calls[0]!;
    expect(args).toEqual({ agentId: "ag1", paths: [] });
    expect(Object.keys(args)).toEqual(["agentId", "paths"]);
  });

  it("persists only direct paths when attaching an inherited-only document directly", async () => {
    renderWithProviders(<ContextTab agent={AGENT} />);

    await waitFor(() =>
      expect(screen.getByText("300 tokens total for this agent + linked skills")).toBeInTheDocument(),
    );

    // specs/prd.md is inherited-only (via linked skill sk1) — it renders
    // under "Available documents", not the interactive attached checklist.
    // Attaching it directly here must persist exactly the direct set,
    // never inflated by anything else inherited.
    const row = screen.getByText("prd.md").closest("div")!;
    const checkbox = row.querySelector('[role="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(setContextMutate).toHaveBeenCalledTimes(1);
    const [args] = setContextMutate.mock.calls[0]!;
    expect(args).toEqual({ agentId: "ag1", paths: ["docs/architecture.md", "specs/prd.md"] });
  });

  it("shows the map-reduce cost-repeats note only when the agent strategy is map-reduce (AC-11)", async () => {
    renderWithProviders(<ContextTab agent={{ ...AGENT, strategy: "map-reduce" }} />);
    await waitFor(() => expect(screen.getByText("architecture.md")).toBeInTheDocument());
    expect(screen.getByText(contextMessages.picker.mapReduceNote)).toBeInTheDocument();
  });
});
