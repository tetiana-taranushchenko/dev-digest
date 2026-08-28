import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PrFile } from "@devdigest/shared";
import type { BriefSectionsState } from "../BriefSections/types";

const useBriefSections = vi.fn();

vi.mock("../BriefSections", () => ({
  useBriefSections: (...args: unknown[]) => useBriefSections(...args),
  BriefSummaryPanel: () => <div data-testid="brief-summary" />,
  RiskAreasPanel: () => <div data-testid="risk-areas" />,
  ReviewFocusPanel: () => <div data-testid="review-focus" />,
}));

vi.mock("../IntentPanel", () => ({
  IntentPanel: () => <div data-testid="intent-panel" />,
}));

vi.mock("../BlastRadiusPanel", () => ({
  BlastRadiusPanel: () => <div data-testid="blast-radius-panel" />,
}));

import { OverviewTab } from "./OverviewTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FILES: PrFile[] = [{ path: "src/example.ts", additions: 1, deletions: 0, patch: null }];

function state(overrides: Partial<BriefSectionsState> = {}): BriefSectionsState {
  return {
    status: "empty",
    brief: null,
    usage: null,
    verdict: null,
    isMutating: false,
    errorMessage: null,
    generate: vi.fn(),
    regenerate: vi.fn(),
    ...overrides,
  };
}

function renderTab(overrides: Partial<React.ComponentProps<typeof OverviewTab>> = {}) {
  return render(
    <OverviewTab
      prId="pr-1"
      prBody="Some description"
      repoId="repo-1"
      prNumber={42}
      repoFullName="acme/widgets"
      headSha="sha1"
      files={FILES}
      {...overrides}
    />,
  );
}

describe("OverviewTab", () => {
  it("calls useBriefSections exactly once and renders sections in order: Summary, Intent, Risk Areas, Review Focus, Blast Radius, Description", () => {
    useBriefSections.mockReturnValue(state());

    renderTab();

    expect(useBriefSections).toHaveBeenCalledTimes(1);
    expect(useBriefSections).toHaveBeenCalledWith("pr-1");

    const ids = screen.getAllByTestId(/.+/).map((el) => el.dataset.testid);
    expect(ids).toEqual(["brief-summary", "intent-panel", "risk-areas", "review-focus", "blast-radius-panel"]);

    expect(screen.getByText("Some description")).toBeInTheDocument();
  });
});
