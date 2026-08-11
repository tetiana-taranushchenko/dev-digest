import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/conventions.json";

const createMutate = vi.fn();
const push = vi.fn();
const draft = {
  name: "repo-conventions",
  description: "House conventions extracted from acme/payments-api.",
  body: "# repo-conventions\n\n## Async\nAlways await service calls.",
  enabled: true,
  candidate_count: 3,
  evidence_files: ["src/api/users.ts"],
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("../../../../lib/hooks/conventions", () => ({
  useConventionSkillDraft: () => ({
    data: draft,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useCreateConventionSkill: () => ({ mutate: createMutate, isPending: false }),
}));

vi.mock("../../../../lib/toast", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

import { CreateSkillModal } from "./CreateSkillModal";

afterEach(() => {
  cleanup();
  createMutate.mockClear();
  push.mockClear();
});

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <CreateSkillModal repoId="repo-1" repoName="payments-api" onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("CreateSkillModal", () => {
  it("shows the accepted-candidate summary and skill-editor metadata", () => {
    renderModal();

    expect(screen.getByText(/3 accepted conventions/i)).toBeInTheDocument();
    expect(screen.getByText("payments-api")).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("convention");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByText("repo-conventions.md").length).toBeGreaterThan(0);
    expect(screen.getByText("unsaved")).toBeInTheDocument();
    expect(screen.getByText(/tokens$/)).toBeInTheDocument();
  });

  it("submits the edited draft and enabled state", () => {
    renderModal();

    fireEvent.change(screen.getByDisplayValue("repo-conventions"), {
      target: { value: "payments-api-conventions" },
    });
    fireEvent.change(screen.getByLabelText("Skill body"), {
      target: { value: "# Edited conventions" },
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: /^create skill$/i }));

    expect(createMutate).toHaveBeenCalledWith(
      {
        name: "payments-api-conventions",
        description: "House conventions extracted from acme/payments-api.",
        body: "# Edited conventions",
        enabled: false,
      },
      expect.any(Object),
    );
  });
});
