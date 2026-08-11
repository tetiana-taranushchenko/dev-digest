import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, AgentSkillLink, Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/agents.json";

const SKILLS: Skill[] = [
  { id: "sk1", name: "Security basics", description: "", type: "security", source: "manual", body: "", enabled: true, version: 1 },
  { id: "sk2", name: "Naming conventions", description: "", type: "convention", source: "manual", body: "", enabled: true, version: 1 },
  { id: "sk3", name: "Custom rubric", description: "", type: "rubric", source: "manual", body: "", enabled: true, version: 1 },
];

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS }),
}));

const LINKS: AgentSkillLink[] = [{ agent_id: "ag1", skill_id: "sk1", order: 0 }];
const setSkillsMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgentSkills: () => ({ data: LINKS }),
  useSetAgentSkills: () => ({ mutate: setSkillsMutate }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(() => {
  cleanup();
  setSkillsMutate.mockClear();
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
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SkillsTab (smoke)", () => {
  it("checking an unlinked skill appends it and posts the full ordered skill_ids", async () => {
    renderWithProviders(<SkillsTab agent={AGENT} />);

    await waitFor(() => expect(screen.getByText("Naming conventions")).toBeInTheDocument());

    const row = screen.getByText("Naming conventions").closest("div")!;
    const checkbox = row.querySelector('[role="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(setSkillsMutate).toHaveBeenCalledTimes(1);
    expect(setSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["sk1", "sk2"] });
  });

  it("unchecking a linked skill removes it and posts the reduced skill_ids", async () => {
    renderWithProviders(<SkillsTab agent={AGENT} />);

    await waitFor(() => expect(screen.getByText("Security basics")).toBeInTheDocument());

    const row = screen.getByText("Security basics").closest("div")!;
    const checkbox = row.querySelector('[role="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(setSkillsMutate).toHaveBeenCalledTimes(1);
    expect(setSkillsMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: [] });
  });
});
