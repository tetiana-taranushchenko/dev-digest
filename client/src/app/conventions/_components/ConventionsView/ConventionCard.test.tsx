import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";

const mutate = vi.fn();

vi.mock("../../../../lib/hooks/conventions", () => ({
  useUpdateConvention: () => ({ mutate, isPending: false }),
}));

vi.mock("../../../../lib/toast", () => ({
  useToast: () => ({ error: vi.fn(), success: vi.fn() }),
}));

import { ConventionCard } from "./ConventionCard";

const candidate: ConventionCandidate = {
  id: "candidate-1",
  category: "async",
  rule: "Use async functions for public route handlers.",
  evidence_path: "src/api/users.ts",
  evidence_line: 25,
  evidence_snippet: "25 | export async function users() {}",
  evidence_ref: "abc123",
  confidence: 0.91,
  status: "pending",
  accepted: false,
};

afterEach(() => {
  cleanup();
  mutate.mockClear();
});

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard
        candidate={candidate}
        repoId="repo-1"
        repoFullName="acme/payments-api"
        fallbackRef="main"
      />
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard", () => {
  it("links evidence to the extracted commit and exact line", () => {
    renderCard();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/abc123/src/api/users.ts#L25",
    );
  });

  it("approves and rejects without removing the candidate", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(mutate).toHaveBeenCalledWith(
      { id: candidate.id, patch: { status: "approved" } },
      expect.any(Object),
    );
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(mutate).toHaveBeenCalledWith(
      { id: candidate.id, patch: { status: "rejected" } },
      expect.any(Object),
    );
  });

  it("submits edited rule text and category", () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const input = screen.getByDisplayValue(candidate.rule);
    fireEvent.change(input, { target: { value: "Always await service calls in route handlers." } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "architecture" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate).toHaveBeenCalledWith(
      {
        id: candidate.id,
        patch: {
          rule: "Always await service calls in route handlers.",
          category: "architecture",
        },
      },
      expect.any(Object),
    );
  });
});

