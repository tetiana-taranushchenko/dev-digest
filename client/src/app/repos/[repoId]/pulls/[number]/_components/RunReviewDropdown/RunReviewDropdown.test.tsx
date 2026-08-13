import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../../../../../../lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [{ id: "a1", name: "Security", model: "deepseek/deepseek-v4-flash", enabled: true }],
  }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown (smoke)", () => {
  it("renders the trigger label", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("shows a compact model name in the agent list", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    fireEvent.click(screen.getByText("Run Review"));

    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
    expect(screen.queryByText("deepseek/deepseek-v4-flash")).not.toBeInTheDocument();
  });
});
