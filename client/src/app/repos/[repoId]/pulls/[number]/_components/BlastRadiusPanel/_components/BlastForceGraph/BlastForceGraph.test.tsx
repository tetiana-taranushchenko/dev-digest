import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DownstreamImpact, PrFile } from "@devdigest/shared";
import messages from "../../../../../../../../../../messages/en/blast.json";
import { githubBlobUrl } from "@/lib/github-urls";
import { buildDiffLineRoute } from "../../../DiffTab/helpers";
import { MAX_GRAPH_NODES } from "./constants";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
}));

import { BlastForceGraph } from "./BlastForceGraph";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const DOWNSTREAM: DownstreamImpact[] = [
  {
    symbol: "doThing",
    file: "src/example.ts",
    caller_count: 2,
    callers: [
      { name: "inDiff", file: "src/consumer.ts", line: 10 },
      { name: "outsideDiff", file: "src/external.ts", line: 42 },
    ],
    endpoints_affected: ["GET /api/public/items"],
    crons_affected: [],
  },
];

const FILES: PrFile[] = [
  {
    path: "src/consumer.ts",
    additions: 1,
    deletions: 1,
    patch: "@@ -10,1 +10,1 @@\n-old\n+new at line 10",
  },
];

function renderGraph(
  overrides: Partial<React.ComponentProps<typeof BlastForceGraph>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastForceGraph
        downstream={DOWNSTREAM}
        files={FILES}
        repoId="repo-1"
        prNumber={42}
        repoFullName="acme/widgets"
        headSha="abc123"
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
}

describe("BlastForceGraph", () => {
  it("renders the force graph, text alternative, legend and accessible-view hint", () => {
    renderGraph();

    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Force-directed graph of 1 changed symbols, 2 callers and 1 affected endpoints or cron jobs.",
        { selector: "desc" },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("doThing()", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("src/consumer.ts:10", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("GET /api/public/items", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("Changed symbol")).toBeInTheDocument();
    expect(screen.getByText("Caller")).toBeInTheDocument();
    expect(screen.getByText("Endpoint")).toBeInTheDocument();
    expect(screen.queryByText("Cron / job")).not.toBeInTheDocument();
    expect(
      screen.getByText("Switch to the tree view for a keyboard-accessible list of the same data."),
    ).toBeInTheDocument();
  });

  it("navigates covered callers in-app, opens GitHub fallbacks and no-ops without link context", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderGraph();

    fireEvent.click(screen.getByText("src/consumer.ts:10", { selector: "text" }));
    expect(routerPush).toHaveBeenCalledWith(buildDiffLineRoute("repo-1", 42, "src/consumer.ts", 10));

    fireEvent.click(screen.getByText("src/external.ts:42", { selector: "text" }));
    expect(open).toHaveBeenCalledWith(
      githubBlobUrl("acme/widgets", "abc123", "src/external.ts", 42),
      "_blank",
      "noopener,noreferrer",
    );

    cleanup();
    routerPush.mockClear();
    open.mockClear();
    renderGraph({ repoFullName: null, headSha: null });

    fireEvent.click(screen.getByText("src/external.ts:42", { selector: "text" }));
    expect(routerPush).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it("renders the cron node and legend entry only when cron impact exists", () => {
    renderGraph({
      downstream: [{ ...DOWNSTREAM[0]!, crons_affected: ["nightly-sync"] }],
    });

    expect(screen.getByText("nightly-sync", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("Cron / job")).toBeInTheDocument();
  });

  it("keeps dense graphs simple by revealing non-symbol labels only on interaction", () => {
    const endpoints = Array.from({ length: 22 }, (_, index) => `GET /api/public/items/${index}`);
    renderGraph({
      downstream: [{ ...DOWNSTREAM[0]!, endpoints_affected: endpoints }],
    });

    const endpoint = endpoints[0]!;
    const endpointNode = screen.getByText(endpoint, { selector: "title" }).parentElement!;
    expect(screen.getByText("doThing()", { selector: "text" })).toBeInTheDocument();
    expect(screen.queryByText(endpoint, { selector: "text" })).not.toBeInTheDocument();

    fireEvent.pointerEnter(endpointNode);
    expect(screen.getByText(endpoint, { selector: "text" })).toBeInTheDocument();

    fireEvent.pointerLeave(endpointNode);
    expect(screen.queryByText(endpoint, { selector: "text" })).not.toBeInTheDocument();

    fireEvent.click(endpointNode);
    expect(screen.getByText(endpoint, { selector: "text" })).toBeInTheDocument();
  });

  it("selects a symbol subgraph, dims unrelated nodes and restores the full graph", () => {
    renderGraph({
      downstream: [
        DOWNSTREAM[0]!,
        {
          symbol: "doOtherThing",
          file: "src/other.ts",
          caller_count: 0,
          callers: [],
          endpoints_affected: ["POST /api/private/items"],
          crons_affected: [],
        },
      ],
    });

    const selectedSymbol = screen.getByText("doThing()", { selector: "text" });
    const relatedCaller = screen.getByText("src/consumer.ts:10", { selector: "text" });
    const unrelatedSymbol = screen.getByText("doOtherThing()", { selector: "text" });
    const unrelatedEndpoint = screen.getByText("POST /api/private/items", { selector: "text" });

    fireEvent.click(selectedSymbol);

    expect(selectedSymbol.closest("g")).toHaveAttribute("opacity", "1");
    expect(relatedCaller.closest("g")).toHaveAttribute("opacity", "1");
    expect(unrelatedSymbol.closest("g")).toHaveAttribute("opacity", "0.25");
    expect(unrelatedEndpoint.closest("g")).toHaveAttribute("opacity", "0.25");

    fireEvent.click(selectedSymbol);

    expect(unrelatedSymbol.closest("g")).toHaveAttribute("opacity", "1");
    expect(unrelatedEndpoint.closest("g")).toHaveAttribute("opacity", "1");
  });

  it("renders only the graph empty message when the model has no nodes", () => {
    renderGraph({ downstream: [] });

    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the exact number of nodes omitted by the graph budget", () => {
    const extraCallers = 6;
    renderGraph({
      downstream: [
        {
          ...DOWNSTREAM[0]!,
          caller_count: MAX_GRAPH_NODES + extraCallers - 1,
          callers: Array.from({ length: MAX_GRAPH_NODES + extraCallers - 1 }, (_, index) => ({
            name: `caller-${index}`,
            file: `src/caller-${index}.ts`,
            line: index + 1,
          })),
          endpoints_affected: [],
        },
      ],
    });

    expect(screen.getByText(`+${extraCallers} more nodes not shown`)).toBeInTheDocument();
  });
});
