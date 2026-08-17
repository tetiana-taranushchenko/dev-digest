import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrFile } from "@devdigest/shared";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import smartDiffMessages from "../../../../../../../../messages/en/smartDiff.json";

const useSmartDiff = vi.fn();
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  usePrComments: () => ({ data: [] }),
  useCreatePrComment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("../../../../../../../lib/hooks/smart-diff", () => ({
  useSmartDiff: (...args: unknown[]) => useSmartDiff(...args),
}));

vi.mock("../SmartDiffViewer", () => ({
  SmartDiffViewer: ({ onFindingClick }: { onFindingClick: (id: string) => void }) => (
    <div data-testid="smart-diff-viewer">
      <button type="button" onClick={() => onFindingClick("finding-2")}>
        warning
      </button>
    </div>
  ),
}));

import { DiffTab } from "./DiffTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FILES: PrFile[] = [
  { path: "src/example.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+example line" },
];

const SMART_DATA = {
  groups: [
    {
      role: "core" as const,
      files: [{ path: "src/example.ts", additions: 1, deletions: 0, finding_lines: [] }],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
};

function renderDiffTab(overrides: Partial<React.ComponentProps<typeof DiffTab>> = {}) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ shell: shellMessages, smartDiff: smartDiffMessages }}>
        <DiffTab
          prId="pr-1"
          repoId="repo-1"
          prNumber={42}
          filesCount={9}
          additions={247}
          deletions={38}
          files={FILES}
          reviews={[]}
          runs={[]}
          {...overrides}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("DiffTab", () => {
  it("defaults to Original order even when Smart data exists and preserves the original list", () => {
    useSmartDiff.mockReturnValue({ data: SMART_DATA });

    renderDiffTab({
      files: [
        { path: "src/z-first.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+first original line" },
        { path: "src/a-second.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+second original line" },
      ],
    });

    expect(screen.getByRole("button", { name: "Original order" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Smart order" })).toHaveAttribute("aria-pressed", "false");
    const firstFile = screen.getByText("src/z-first.ts");
    const secondFile = screen.getByText("src/a-second.ts");
    expect(firstFile.compareDocumentPosition(secondFile) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByRole("button", { name: /Open .* finding/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("smart-diff-viewer")).not.toBeInTheDocument();
  });

  it("shows authoritative PR totals rather than recomputing the loaded file subset", () => {
    useSmartDiff.mockReturnValue({ data: SMART_DATA });

    renderDiffTab();

    const summary = screen.getByLabelText("Pull request diff summary");
    expect(summary).toHaveTextContent("9 files");
    expect(summary).toHaveTextContent("+247");
    expect(summary).toHaveTextContent("−38");
  });

  it.each([
    ["loading", { data: undefined, isLoading: true }],
    ["error", { data: undefined, isError: true, error: new Error("boom") }],
    ["empty groups", { data: { groups: [], split_suggestion: SMART_DATA.split_suggestion } }],
  ])("disables Smart order during %s and keeps the flat diff usable", (_label, state) => {
    useSmartDiff.mockReturnValue(state);

    renderDiffTab();

    expect(screen.getByRole("button", { name: "Smart order" })).toBeDisabled();
    expect(screen.getByText("example line")).toBeInTheDocument();
  });

  it("switches to Smart order and routes an inline marker to the exact FindingCard query", () => {
    useSmartDiff.mockReturnValue({ data: SMART_DATA });
    renderDiffTab();

    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(screen.getByRole("button", { name: "Smart order" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("smart-diff-viewer")).toBeInTheDocument();
    expect(screen.queryByText("example line")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "warning" }));
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith(
      "/repos/repo-1/pulls/42?tab=findings&finding=finding-2",
    );
  });

  it("keeps instructor large-file emphasis in Original order", () => {
    useSmartDiff.mockReturnValue({ data: SMART_DATA });
    renderDiffTab({
      files: [
        { path: "src/large.ts", additions: 151, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+large line" },
      ],
    });

    expect(screen.getByLabelText("Large file src/large.ts: 151 changed lines")).toBeInTheDocument();
  });
});
