import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius, PrFile, PriorPr } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const usePrBlastRadius = vi.fn();
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("../../../../../../../lib/hooks/blast", () => ({
  usePrBlastRadius: (...args: unknown[]) => usePrBlastRadius(...args),
}));

import { BlastRadiusPanel } from "./BlastRadiusPanel";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const FILES: PrFile[] = [{ path: "src/example.ts", additions: 1, deletions: 0, patch: null }];

// Relative to Date.now() at test-run time so `formatPriorPrAge` (which
// defaults to Date.now()) lands in a predictable bucket without needing to
// inject a fixed `now` through the component.
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

const THREE_PRIOR_PRS: PriorPr[] = [
  { number: 101, title: "Refactor auth module", updated_at: daysAgo(5) },
  { number: 87, title: "Add rate limiter", updated_at: daysAgo(60) },
  { number: 52, title: "Fix flaky test", updated_at: daysAgo(1) },
];

function okData(overrides: Partial<BlastRadius> = {}): BlastRadius {
  return {
    changed_symbols: [{ name: "doThing", file: "src/example.ts", kind: "function" }],
    downstream: [
      {
        symbol: "doThing",
        file: "src/example.ts",
        caller_count: 2,
        callers: [
          { name: "caller1", file: "src/consumer.ts", line: 10 },
          { name: "caller2", file: "src/example.ts", line: 5 },
        ],
        endpoints_affected: ["GET /api/public/items"],
        crons_affected: [],
      },
    ],
    summary: "",
    state: "ok",
    reason: null,
    reason_text: null,
    truncated: false,
    index_status: "full",
    generated_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof BlastRadiusPanel>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastRadiusPanel
        prId="pr-1"
        repoId="repo-1"
        prNumber={42}
        repoFullName="acme/widgets"
        headSha="sha1"
        files={FILES}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("BlastRadiusPanel", () => {
  it("shows a caller count and expands a symbol row to reveal file:line rows and endpoint badges", () => {
    usePrBlastRadius.mockReturnValue({ data: okData(), isLoading: false });
    renderPanel();

    // "2 callers" appears both in the new stats row summary and in this
    // symbol's own caller-count badge — scope to the symbol row's toggle
    // button to assert the latter specifically.
    const symbolToggle = screen.getByRole("button", { name: /doThing/ });
    expect(within(symbolToggle).getByText("2 callers")).toBeInTheDocument();
    expect(screen.queryByText("src/consumer.ts:10")).not.toBeInTheDocument();

    fireEvent.click(symbolToggle);

    expect(screen.getByText("src/consumer.ts:10")).toBeInTheDocument();
    expect(screen.getByText("src/example.ts:5")).toBeInTheDocument();
    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
  });

  it("renders a stats row with deduped endpoint/cron counts across symbols, not a naive sum", () => {
    usePrBlastRadius.mockReturnValue({
      data: okData({
        changed_symbols: [
          { name: "doThing", file: "src/example.ts", kind: "function" },
          { name: "otherThing", file: "src/other.ts", kind: "function" },
        ],
        downstream: [
          {
            symbol: "doThing",
            file: "src/example.ts",
            // True pre-cap count, deliberately higher than callers.length to
            // prove the stats row sums caller_count, not the capped list.
            caller_count: 20,
            callers: [{ name: "caller1", file: "src/consumer.ts", line: 10 }],
            endpoints_affected: ["GET /api/public/items", "POST /api/public/items"],
            crons_affected: ["nightly-sync"],
          },
          {
            symbol: "otherThing",
            file: "src/other.ts",
            caller_count: 5,
            callers: [{ name: "caller2", file: "src/consumer.ts", line: 20 }],
            // "GET /api/public/items" repeats under a second symbol — the
            // header total must dedupe it, not double-count it.
            endpoints_affected: ["GET /api/public/items", "GET /api/other"],
            crons_affected: ["nightly-sync"],
          },
        ],
      }),
      isLoading: false,
    });
    renderPanel();

    // symbols: 2, callers: 20 + 5 = 25 (true caller_count sum, not capped-list length)
    expect(screen.getByText(/2\s*symbols/)).toBeInTheDocument();
    expect(screen.getByText(/25\s*callers/)).toBeInTheDocument();
    // endpoints: {"GET /api/public/items", "POST /api/public/items", "GET /api/other"} = 3 unique, not 4
    expect(screen.getByText(/3\s*endpoints/)).toBeInTheDocument();
    // crons: {"nightly-sync"} = 1 unique, not 2
    expect(screen.getByText(/1\s*cron\/jobs/)).toBeInTheDocument();
  });

  it("shows the empty state when the index is healthy but nothing downstream was found", () => {
    usePrBlastRadius.mockReturnValue({
      data: okData({ downstream: [], state: "empty", reason: "no_impact", reason_text: "Nothing found." }),
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByText("No downstream impact found")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows a distinct degraded notice instead of the empty state (REQ-4)", () => {
    usePrBlastRadius.mockReturnValue({
      data: okData({
        downstream: [],
        state: "degraded",
        index_status: "missing",
        reason: "no_data",
        reason_text: "No index data is available for this repo yet.",
      }),
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Degraded index")).toBeInTheDocument();
    expect(screen.getByText("No index data is available for this repo yet.")).toBeInTheDocument();
    expect(screen.queryByText("No downstream impact found")).not.toBeInTheDocument();
  });

  it("shows a distinct partial notice (not the empty or degraded copy) for a partial-index/truncated result", () => {
    usePrBlastRadius.mockReturnValue({
      data: okData({
        state: "partial",
        index_status: "partial",
        reason: "index_partial",
        reason_text: "The repo-intel index is only partially built, so some callers may be missing.",
      }),
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Partial results")).toBeInTheDocument();
    expect(screen.getByText("The repo-intel index is only partially built, so some callers may be missing.")).toBeInTheDocument();
    // Distinct from both the "nothing found" empty state and the degraded-index notice.
    expect(screen.queryByText("No downstream impact found")).not.toBeInTheDocument();
    expect(screen.queryByText("Degraded index")).not.toBeInTheDocument();
  });

  it("falls back to the server's raw reason_text when the machine reason code has no translated copy", () => {
    usePrBlastRadius.mockReturnValue({
      data: okData({
        downstream: [],
        state: "degraded",
        index_status: "degraded",
        // A machine reason the client's reason-code map doesn't recognize
        // (e.g. a newer server introduced it) — the UI must still surface
        // the server's human-readable reason_text verbatim rather than
        // silently rendering nothing (REQ-4).
        reason: "some_future_reason_code",
        reason_text: "A brand-new degraded condition the client has never heard of.",
      }),
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Degraded index")).toBeInTheDocument();
    expect(screen.getByText("A brand-new degraded condition the client has never heard of.")).toBeInTheDocument();
  });

  it("truncates a long endpoints list to 6 badges with a '+N more' toggle that expands and collapses", () => {
    const manyEndpoints = Array.from({ length: 9 }, (_, i) => `GET /api/public/item-${i}`);
    usePrBlastRadius.mockReturnValue({
      data: okData({
        downstream: [
          {
            symbol: "doThing",
            file: "src/example.ts",
            caller_count: 0,
            callers: [],
            endpoints_affected: manyEndpoints,
            crons_affected: [],
          },
        ],
      }),
      isLoading: false,
    });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /doThing/ }));

    // Only the first 6 render initially, plus a "+3 more" toggle.
    manyEndpoints.slice(0, 6).forEach((endpoint) => {
      expect(screen.getByText(endpoint)).toBeInTheDocument();
    });
    manyEndpoints.slice(6).forEach((endpoint) => {
      expect(screen.queryByText(endpoint)).not.toBeInTheDocument();
    });
    const moreToggle = screen.getByRole("button", { name: "+3 more" });
    expect(moreToggle).toBeInTheDocument();

    fireEvent.click(moreToggle);

    // All 9 now render, and the toggle reads "show less".
    manyEndpoints.forEach((endpoint) => {
      expect(screen.getByText(endpoint)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "show less" })).toBeInTheDocument();
  });

  it("renders a short endpoints list in full with no truncation toggle", () => {
    usePrBlastRadius.mockReturnValue({ data: okData(), isLoading: false });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /doThing/ }));

    expect(screen.getByText("GET /api/public/items")).toBeInTheDocument();
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/show less/)).not.toBeInTheDocument();
  });

  it("switches between the tree and graph views", () => {
    usePrBlastRadius.mockReturnValue({ data: okData(), isLoading: false });
    renderPanel();

    expect(screen.getByRole("button", { name: "tree" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "graph" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "graph" }));

    expect(screen.getByRole("button", { name: "graph" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(screen.getByText("doThing()", { selector: "text" })).toBeInTheDocument();
  });

  it("defaults to the accessible tree view and shows its accessibility hint in graph view", () => {
    usePrBlastRadius.mockReturnValue({ data: okData(), isLoading: false });
    renderPanel();

    expect(screen.getByRole("button", { name: "tree" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("img", { name: "Blast radius graph" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "graph" }));

    expect(
      screen.getByText("Switch to the tree view for a keyboard-accessible list of the same data."),
    ).toBeInTheDocument();
  });

  it("starts the prior-PRs row collapsed, expands it to reveal links and ages, then collapses it again", () => {
    usePrBlastRadius.mockReturnValue({ data: okData({ prior_prs: THREE_PRIOR_PRS }), isLoading: false });
    renderPanel();

    const toggle = screen.getByRole("button", { name: /prior prs/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle).getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("Refactor auth module")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Refactor auth module")).toBeInTheDocument();
    expect(screen.getByText("Add rate limiter")).toBeInTheDocument();
    expect(screen.getByText("Fix flaky test")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Refactor auth module/ })).toHaveAttribute(
      "href",
      "/repos/repo-1/pulls/101",
    );
    expect(screen.getByRole("link", { name: /Add rate limiter/ })).toHaveAttribute(
      "href",
      "/repos/repo-1/pulls/87",
    );
    expect(screen.getByRole("link", { name: /Fix flaky test/ })).toHaveAttribute(
      "href",
      "/repos/repo-1/pulls/52",
    );

    // A `d`-bucket and an `mo`-bucket age both appear.
    expect(screen.getByText("5d ago")).toBeInTheDocument();
    expect(screen.getByText("2mo ago")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Refactor auth module")).not.toBeInTheDocument();
    expect(screen.queryByText("Add rate limiter")).not.toBeInTheDocument();
    expect(screen.queryByText("Fix flaky test")).not.toBeInTheDocument();
  });

  it("renders no prior-PRs row when the list is empty", () => {
    usePrBlastRadius.mockReturnValue({ data: okData({ prior_prs: [] }), isLoading: false });
    renderPanel();

    expect(screen.queryByRole("button", { name: /prior prs/i })).not.toBeInTheDocument();
  });

  it("renders no prior-PRs row when the field is omitted", () => {
    usePrBlastRadius.mockReturnValue({ data: okData(), isLoading: false });
    renderPanel();

    expect(screen.queryByRole("button", { name: /prior prs/i })).not.toBeInTheDocument();
  });

  it("shows the prior-PRs toggle alongside the empty state", () => {
    usePrBlastRadius.mockReturnValue({
      data: okData({ downstream: [], state: "empty", prior_prs: THREE_PRIOR_PRS.slice(0, 2) }),
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByText("No downstream impact found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prior prs/i })).toBeInTheDocument();
  });
});
