import { describe, expect, it } from "vitest";
import type { DownstreamImpact } from "@devdigest/shared";
import { MAX_GRAPH_NODES, MAX_LABEL_CHARS } from "./constants";
import { buildBlastGraph } from "./graph-model";

function impact(overrides: Partial<DownstreamImpact> = {}): DownstreamImpact {
  return {
    symbol: "doThing",
    file: "src/example.ts",
    caller_count: 0,
    callers: [],
    endpoints_affected: [],
    crons_affected: [],
    ...overrides,
  };
}

describe("buildBlastGraph", () => {
  it("builds the expected node ids, kinds and labels for every supported kind", () => {
    const longEndpoint = "GET /api/public/items/with/a/long/path";
    const model = buildBlastGraph([
      impact({
        caller_count: 1,
        callers: [{ name: "consume", file: "src/consumer.ts", line: 10 }],
        endpoints_affected: [longEndpoint],
        crons_affected: ["nightly-sync"],
      }),
    ]);

    expect(model.nodes).toEqual([
      expect.objectContaining({
        id: "symbol:src/example.ts#doThing",
        kind: "symbol",
        label: "doThing()",
        title: "doThing()",
      }),
      expect.objectContaining({
        id: "caller:src/consumer.ts:10",
        kind: "caller",
        label: "src/consumer.ts:10",
        title: "src/consumer.ts:10",
        caller: { name: "consume", file: "src/consumer.ts", line: 10 },
      }),
      expect.objectContaining({
        id: `endpoint:${longEndpoint}`,
        kind: "endpoint",
        title: longEndpoint,
      }),
      expect.objectContaining({
        id: "cron:nightly-sync",
        kind: "cron",
        label: "nightly-sync",
        title: "nightly-sync",
      }),
    ]);
    expect(model.nodes[2]?.label).toHaveLength(MAX_LABEL_CHARS);
    expect(model.nodes[2]?.label).toContain("…");
  });

  it("deduplicates callers, endpoints and cron jobs shared by two symbols while retaining both links", () => {
    const caller = { name: "shared", file: "src/shared.ts", line: 20 };
    const model = buildBlastGraph([
      impact({
        callers: [caller],
        caller_count: 1,
        endpoints_affected: ["GET /shared"],
        crons_affected: ["nightly-sync"],
      }),
      impact({
        symbol: "doOtherThing",
        file: "src/other.ts",
        callers: [caller],
        caller_count: 1,
        endpoints_affected: ["GET /shared"],
        crons_affected: ["nightly-sync"],
      }),
    ]);

    expect(model.nodes.filter((node) => node.kind === "caller")).toHaveLength(1);
    expect(model.nodes.filter((node) => node.kind === "endpoint")).toHaveLength(1);
    expect(model.nodes.filter((node) => node.kind === "cron")).toHaveLength(1);
    expect(model.links.filter((link) => link.target === "caller:src/shared.ts:20")).toEqual([
      { source: "symbol:src/example.ts#doThing", target: "caller:src/shared.ts:20" },
      { source: "symbol:src/other.ts#doOtherThing", target: "caller:src/shared.ts:20" },
    ]);
    expect(model.links.filter((link) => link.target === "endpoint:GET /shared")).toHaveLength(2);
    expect(model.links.filter((link) => link.target === "cron:nightly-sync")).toHaveLength(2);
  });

  it("truncates a large graph deterministically while retaining all symbol nodes", () => {
    const downstream = Array.from({ length: 10 }, (_, symbolIndex) =>
      impact({
        symbol: `symbol-${symbolIndex}`,
        file: `src/symbol-${symbolIndex}.ts`,
        caller_count: 20,
        callers: Array.from({ length: 20 }, (_, callerIndex) => ({
          name: `caller-${symbolIndex}-${callerIndex}`,
          file: `src/caller-${symbolIndex}-${callerIndex}.ts`,
          line: callerIndex + 1,
        })),
      }),
    );

    const model = buildBlastGraph(downstream);

    expect(model.nodes).toHaveLength(MAX_GRAPH_NODES);
    expect(model.nodes.filter((node) => node.kind === "symbol")).toHaveLength(10);
    expect(model.hiddenNodeCount).toBe(90);
  });

  it("uses degree before id when deciding which same-kind node survives truncation", () => {
    const sharedCaller = { name: "shared", file: "src/z-shared.ts", line: 1 };
    const lowDegreeCaller = { name: "single", file: "src/a-single.ts", line: 1 };
    const downstream = Array.from({ length: MAX_GRAPH_NODES - 1 }, (_, index) =>
      impact({
        symbol: `symbol-${index}`,
        file: `src/symbol-${index}.ts`,
        caller_count: index < 2 ? 1 : index === 2 ? 1 : 0,
        callers: index < 2 ? [sharedCaller] : index === 2 ? [lowDegreeCaller] : [],
      }),
    );

    const model = buildBlastGraph(downstream);

    expect(model.nodes.filter((node) => node.kind === "symbol")).toHaveLength(
      MAX_GRAPH_NODES - 1,
    );
    expect(model.nodes.filter((node) => node.kind === "caller").map((node) => node.id)).toEqual([
      "caller:src/z-shared.ts:1",
    ]);
    expect(model.hiddenNodeCount).toBe(1);
  });

  it("drops links to nodes omitted by the graph budget", () => {
    const model = buildBlastGraph([
      impact({
        caller_count: MAX_GRAPH_NODES + 10,
        callers: Array.from({ length: MAX_GRAPH_NODES + 10 }, (_, index) => ({
          name: `caller-${index}`,
          file: `src/caller-${index}.ts`,
          line: index + 1,
        })),
      }),
    ]);
    const nodeIds = new Set(model.nodes.map((node) => node.id));

    expect(model.links.every((link) => nodeIds.has(link.source) && nodeIds.has(link.target))).toBe(true);
  });

  it("produces an identical node order for repeated calls with the same input", () => {
    const downstream = [
      impact({
        callers: [
          { name: "z", file: "src/z.ts", line: 2 },
          { name: "a", file: "src/a.ts", line: 1 },
        ],
        caller_count: 2,
        endpoints_affected: ["POST /z", "GET /a"],
        crons_affected: ["weekly", "daily"],
      }),
    ];

    const first = buildBlastGraph(downstream).nodes.map((node) => node.id);
    const second = buildBlastGraph(downstream).nodes.map((node) => node.id);

    expect(second).toEqual(first);
  });
});
