import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Brief, PrFile } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { BriefSummaryPanel } from "./BriefSummaryPanel";
import { RiskAreasPanel } from "./RiskAreasPanel";
import { ReviewFocusPanel } from "./ReviewFocusPanel";
import type { BriefSectionsState, BriefVerdictInfo } from "./types";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function withIntl(children: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={{ brief: messages, prReview: prReviewMessages }}>
      {children}
    </NextIntlClientProvider>
  );
}

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

const BRIEF: Brief = {
  what: "Adds a one-shot PR brief to the Overview tab.",
  why: "Reviewers need a fast synthesis of what changed and where to look.",
  risk_level: "high",
  risks: [
    {
      kind: "correctness",
      title: "Unvalidated user input",
      explanation: "The new endpoint doesn't validate the request body.",
      severity: "high",
      file_refs: ["src/server/routes.ts"],
    },
  ],
  review_focus: [
    { file: "src/server/routes.ts", line: 42, reason: "New unvalidated input path." },
    { file: "src/not-in-diff.ts", line: 5, reason: "Referenced but not part of this PR's diff." },
  ],
};

const FILES: PrFile[] = [{ path: "src/server/routes.ts", additions: 3, deletions: 0, patch: null }];

function renderAllThree(s: BriefSectionsState) {
  return render(
    withIntl(
      <>
        <BriefSummaryPanel state={s} />
        <RiskAreasPanel state={s} />
        <ReviewFocusPanel state={s} repoId="repo-1" prNumber={42} files={FILES} />
      </>,
    ),
  );
}

describe("BriefSections panels — coordination (AC-25/AC-28)", () => {
  it("AC-25: while loading/mutating, all three panels show a loading state, none shows stale brief content, and the regenerate control is disabled", () => {
    renderAllThree(state({ status: "loading", isMutating: true, brief: null }));

    // Summary's regenerate/generate control is disabled during the shared mutation.
    expect(screen.getByRole("button", { name: "Regenerate this PR's brief" })).toBeDisabled();

    // None of the ready-state content renders anywhere.
    expect(screen.queryByText(BRIEF.what)).not.toBeInTheDocument();
    expect(screen.queryByText(BRIEF.risks[0]!.title)).not.toBeInTheDocument();
    expect(screen.queryByText(/src\/server\/routes\.ts:42/)).not.toBeInTheDocument();
  });

  it("AC-28: on a generation failure, Summary shows the error + retry while Risk Areas and Review Focus render nothing", () => {
    renderAllThree(state({ status: "error", errorMessage: "Model call failed." }));

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Model call failed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();

    // No partially-generated or stale Brief anywhere (AC-28).
    expect(screen.queryByText("Risk Areas")).not.toBeInTheDocument();
    expect(screen.queryByText("Review Focus")).not.toBeInTheDocument();
  });

  it("no-agent: all three panels render nothing", () => {
    const { container } = renderAllThree(state({ status: "no-agent" }));
    expect(container).toBeEmptyDOMElement();
  });

  it("empty: Summary shows an explicit generate CTA (AC-24); the other two render nothing", () => {
    renderAllThree(state({ status: "empty" }));

    expect(screen.getByText("No brief generated yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
    expect(screen.queryByText("Risk Areas")).not.toBeInTheDocument();
    expect(screen.queryByText("Review Focus")).not.toBeInTheDocument();
  });
});

describe("BriefSummaryPanel — ready state", () => {
  it("renders what/why as prose and risk_level as accessible TEXT, not colour alone", () => {
    render(withIntl(<BriefSummaryPanel state={state({ status: "ready", brief: BRIEF })} />));

    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.why)).toBeInTheDocument();
    // The risk level is queryable by its translated text, and carries an
    // accessible name via role="status" — never colour alone.
    expect(screen.getByRole("status", { name: "Risk level: High risk" })).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();

    const regenerate = screen.getByRole("button", { name: "Regenerate this PR's brief" });
    expect(regenerate).toBeEnabled();
    fireEvent.click(regenerate);
  });

  it("merges the latest review's verdict/findings/score into the same card when present (2026-08-29 product direction)", () => {
    const verdict: BriefVerdictInfo = {
      verdict: "approve",
      score: 67,
      findingsCount: 5,
      blockers: 0,
      agentName: "Reviewer",
    };
    render(withIntl(<BriefSummaryPanel state={state({ status: "ready", brief: BRIEF, verdict })} />));

    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("5 findings")).toBeInTheDocument();
    expect(screen.getByText("67")).toBeInTheDocument();
    expect(screen.getByText("PR SCORE")).toBeInTheDocument();
    // Still present alongside the verdict — the Brief's own content isn't lost.
    expect(screen.getByText(BRIEF.what)).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();
  });

  it("omits the verdict row entirely when no review run has completed yet (verdict: null)", () => {
    render(withIntl(<BriefSummaryPanel state={state({ status: "ready", brief: BRIEF, verdict: null })} />));

    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
  });
});

describe("RiskAreasPanel — ready state", () => {
  it("renders one entry per risk with a text severity label, title, explanation, and non-navigating monospace file_refs, operable by keyboard alone", () => {
    render(withIntl(<RiskAreasPanel state={state({ status: "ready", brief: BRIEF })} />));

    const toggle = screen.getByRole("button", { name: /Unvalidated user input/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Severity is queryable by text, not colour.
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.queryByText("The new endpoint doesn't validate the request body.")).not.toBeInTheDocument();

    // It's a real <button> — reachable by tab and keyboard-operable by
    // construction (Enter/Space activate a native button).
    toggle.focus();
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("The new endpoint doesn't validate the request body.")).toBeInTheDocument();
    expect(screen.getByText("src/server/routes.ts")).toBeInTheDocument();
  });

  it("shows the shared noRisks copy when the grounding gate drops every risk (AC-16)", () => {
    render(
      withIntl(<RiskAreasPanel state={state({ status: "ready", brief: { ...BRIEF, risks: [] } })} />),
    );

    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });
});

describe("ReviewFocusPanel — ready state and AC-27 backstop", () => {
  it("each item is a focusable control with an accessible name including its file, and navigates via the existing diff-line deep link when the file is in the PR's diff", () => {
    render(
      withIntl(
        <ReviewFocusPanel
          state={state({ status: "ready", brief: BRIEF })}
          repoId="repo-1"
          prNumber={42}
          files={FILES}
        />,
      ),
    );

    const inDiffItem = screen.getByRole("button", { name: "src/server/routes.ts, line 42" });
    inDiffItem.focus();
    expect(inDiffItem).toHaveFocus();

    fireEvent.click(inDiffItem);
    expect(routerPush).toHaveBeenCalledWith("/repos/repo-1/pulls/42?tab=diff&file=src%2Fserver%2Froutes.ts&line=42");
  });

  it("AC-27 backstop: clicking an item whose file is absent from the PR's files shows the not-in-diff message and does not navigate", () => {
    render(
      withIntl(
        <ReviewFocusPanel
          state={state({ status: "ready", brief: BRIEF })}
          repoId="repo-1"
          prNumber={42}
          files={FILES}
        />,
      ),
    );

    const notInDiffItem = screen.getByRole("button", { name: "src/not-in-diff.ts, line 5" });
    expect(screen.getByText("File not in this PR's diff")).toBeInTheDocument();

    fireEvent.click(notInDiffItem);
    expect(routerPush).not.toHaveBeenCalled();
  });
});
