import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/agents.json";

const mutateAsync = vi.fn().mockResolvedValue({ id: "agent-1" });
const push = vi.fn();

const openRouterModels = [
  {
    id: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    pricing: { promptPerM: 0.14, completionPerM: 0.28 },
    contextLength: 1_000_000,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    pricing: { promptPerM: 0.44, completionPerM: 0.87 },
    contextLength: 1_000_000,
  },
];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("../../../../../../lib/hooks/agents", () => ({
  useCreateAgent: () => ({ mutateAsync, isPending: false }),
  useProviderModels: (provider: string) => ({
    data: provider === "openrouter" ? openRouterModels : [{ id: "gpt-4.1", provider: "openai" }],
  }),
}));

import { CreateAgentModal } from "./CreateAgentModal";

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
  push.mockClear();
});

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <CreateAgentModal onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("CreateAgentModal", () => {
  it("searches provider models and creates the agent with the selected model", async () => {
    renderModal();

    expect(screen.getByRole("combobox")).toHaveValue("openrouter");
    fireEvent.click(screen.getByText(/deepseek\/deepseek-v4-flash —/i));
    fireEvent.change(screen.getByPlaceholderText("Search models…"), {
      target: { value: "v4-pro" },
    });
    fireEvent.click(screen.getByRole("button", { name: /deepseek\/deepseek-v4-pro/i }));
    fireEvent.change(screen.getByPlaceholderText("Security Reviewer"), {
      target: { value: "API Contract Reviewer" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create agent$/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "API Contract Reviewer",
          provider: "openrouter",
          model: "deepseek/deepseek-v4-pro",
        }),
      ),
    );
  });
});
