import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/agents.json";

const push = vi.fn();
const replace = vi.fn();
const agent = {
  id: "agent-1",
  name: "API Contract Reviewer",
  description: "Reviews API contracts",
  provider: "openrouter",
  model: "deepseek/deepseek-v4-flash",
  system_prompt: "Review the API contract.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "agent-1" }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams("tab=config"),
}));

vi.mock("../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: [agent] }),
  useAgent: () => ({ data: agent, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useUpdateAgent: () => ({ mutate: vi.fn() }),
}));

vi.mock("../_components/AgentCard", () => ({
  AgentCard: () => <div>Agent card</div>,
}));

vi.mock("./_components/AgentEditor", () => ({
  AgentEditor: () => <div>Agent editor</div>,
}));

vi.mock("../_components/AgentsListView/_components/CreateAgentModal", () => ({
  CreateAgentModal: () => <div role="dialog">Create agent dialog</div>,
}));

import AgentEditorPage from "./page";

afterEach(() => {
  cleanup();
  push.mockClear();
  replace.mockClear();
});

describe("AgentEditorPage", () => {
  it("opens Create agent from the sidebar menu without navigating away", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <AgentEditorPage />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /add agent/i }));
    fireEvent.click(screen.getByRole("button", { name: /create from scratch/i }));

    expect(screen.getByRole("dialog")).toHaveTextContent("Create agent dialog");
    expect(push).not.toHaveBeenCalled();
  });
});
