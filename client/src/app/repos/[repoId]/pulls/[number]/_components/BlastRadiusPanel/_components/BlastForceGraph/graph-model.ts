import type { BlastCaller, DownstreamImpact } from "@devdigest/shared";
import { MAX_GRAPH_NODES, MAX_LABEL_CHARS } from "./constants";

export type BlastNodeKind = "symbol" | "caller" | "endpoint" | "cron";

export interface BlastGraphNode {
  id: string;
  kind: BlastNodeKind;
  label: string;
  title: string;
  caller?: BlastCaller;
  degree: number;
}

export interface BlastGraphLink {
  source: string;
  target: string;
}

export interface BlastGraphModel {
  nodes: BlastGraphNode[];
  links: BlastGraphLink[];
  hiddenNodeCount: number;
}

export function middleEllipsis(value: string, maxChars = MAX_LABEL_CHARS): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 0) return "";
  if (maxChars === 1) return "…";

  const visibleChars = maxChars - 1;
  const leadingChars = Math.ceil(visibleChars / 2);
  const trailingChars = Math.floor(visibleChars / 2);

  return `${value.slice(0, leadingChars)}…${value.slice(value.length - trailingChars)}`;
}

function createNode(
  id: string,
  kind: BlastNodeKind,
  title: string,
  caller?: BlastCaller,
): BlastGraphNode {
  return {
    id,
    kind,
    label: middleEllipsis(title),
    title,
    ...(caller ? { caller } : {}),
    degree: 0,
  };
}

function compareNodes(left: BlastGraphNode, right: BlastGraphNode): number {
  return right.degree - left.degree || left.id.localeCompare(right.id);
}

export function buildBlastGraph(downstream: DownstreamImpact[]): BlastGraphModel {
  const nodesByKind: Record<BlastNodeKind, Map<string, BlastGraphNode>> = {
    symbol: new Map(),
    caller: new Map(),
    endpoint: new Map(),
    cron: new Map(),
  };
  const linksByKey = new Map<string, BlastGraphLink>();

  const addLink = (source: BlastGraphNode, target: BlastGraphNode) => {
    const key = JSON.stringify([source.id, target.id]);
    if (linksByKey.has(key)) return;

    linksByKey.set(key, { source: source.id, target: target.id });
    source.degree += 1;
    target.degree += 1;
  };

  for (const impact of downstream) {
    const symbolId = `symbol:${impact.file}#${impact.symbol}`;
    let symbolNode = nodesByKind.symbol.get(symbolId);
    if (!symbolNode) {
      const title = `${impact.symbol}()`;
      symbolNode = createNode(symbolId, "symbol", title);
      nodesByKind.symbol.set(symbolId, symbolNode);
    }

    for (const caller of impact.callers) {
      const title = `${caller.file}:${caller.line}`;
      const callerId = `caller:${title}`;
      let callerNode = nodesByKind.caller.get(callerId);
      if (!callerNode) {
        callerNode = createNode(callerId, "caller", title, caller);
        nodesByKind.caller.set(callerId, callerNode);
      }
      addLink(symbolNode, callerNode);
    }

    for (const endpoint of impact.endpoints_affected) {
      const endpointId = `endpoint:${endpoint}`;
      let endpointNode = nodesByKind.endpoint.get(endpointId);
      if (!endpointNode) {
        endpointNode = createNode(endpointId, "endpoint", endpoint);
        nodesByKind.endpoint.set(endpointId, endpointNode);
      }
      addLink(symbolNode, endpointNode);
    }

    for (const cron of impact.crons_affected) {
      const cronId = `cron:${cron}`;
      let cronNode = nodesByKind.cron.get(cronId);
      if (!cronNode) {
        cronNode = createNode(cronId, "cron", cron);
        nodesByKind.cron.set(cronId, cronNode);
      }
      addLink(symbolNode, cronNode);
    }
  }

  const allNodes = (["symbol", "caller", "endpoint", "cron"] as const).flatMap((kind) =>
    [...nodesByKind[kind].values()].sort(compareNodes),
  );
  const nodes = allNodes.slice(0, MAX_GRAPH_NODES);
  const retainedIds = new Set(nodes.map((node) => node.id));
  const links = [...linksByKey.values()]
    .filter((link) => retainedIds.has(link.source) && retainedIds.has(link.target))
    .sort((left, right) =>
      left.source.localeCompare(right.source) || left.target.localeCompare(right.target),
    );

  return {
    nodes,
    links,
    hiddenNodeCount: allNodes.length - nodes.length,
  };
}
