"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import {
  CHARGE_STRENGTH,
  DRAG_ALPHA_TARGET,
  LINK_DISTANCE,
  NODE_RADIUS,
  SIMULATION_TICKS,
  VIEWBOX,
} from "./constants";
import type { BlastGraphModel, BlastGraphNode } from "./graph-model";

type SimulationGraphNode = BlastGraphNode & SimulationNodeDatum;
type SimulationGraphLink = SimulationLinkDatum<SimulationGraphNode>;

export type PositionedNode = SimulationGraphNode & { x: number; y: number };

export interface PositionedLink {
  source: PositionedNode;
  target: PositionedNode;
}

const VIEWBOX_PADDING = 24;

/** Return safe graph coordinates without mutating d3's simulation node. */
export function clampToViewBox(
  node: Pick<SimulationGraphNode, "kind" | "x" | "y">,
): { x: number; y: number } {
  const radius = NODE_RADIUS[node.kind];
  const padding = VIEWBOX_PADDING + radius;
  const x = Number.isFinite(node.x) ? node.x! : VIEWBOX.width / 2;
  const y = Number.isFinite(node.y) ? node.y! : VIEWBOX.height / 2;

  return {
    x: Math.min(VIEWBOX.width - padding, Math.max(padding, x)),
    y: Math.min(VIEWBOX.height - padding, Math.max(padding, y)),
  };
}

export function useForceLayout(model: BlastGraphModel): {
  nodes: PositionedNode[];
  links: PositionedLink[];
  draggingId: string | null;
  onNodePointerDown: (id: string, event: ReactPointerEvent<SVGGElement>) => void;
} {
  const [nodes, setNodes] = useState<PositionedNode[]>([]);
  const [links, setLinks] = useState<PositionedLink[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const simulationRef = useRef<Simulation<SimulationGraphNode, SimulationGraphLink> | null>(null);
  const simulationNodesRef = useRef<PositionedNode[]>([]);
  const draggingIdRef = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const simulationNodes: SimulationGraphNode[] = model.nodes.map((node) => ({ ...node }));
    const simulationLinks: SimulationGraphLink[] = model.links.map((link) => ({ ...link }));

    setDraggingId(null);
    draggingIdRef.current = null;

    if (simulationNodes.length === 0) {
      setNodes([]);
      setLinks([]);
      simulationNodesRef.current = [];
      simulationRef.current = null;
      return;
    }

    const simulation = forceSimulation<SimulationGraphNode>(simulationNodes)
      .force(
        "link",
        forceLink<SimulationGraphNode, SimulationGraphLink>(simulationLinks)
          .id((node) => node.id)
          .distance(LINK_DISTANCE),
      )
      .force("charge", forceManyBody().strength(CHARGE_STRENGTH))
      .force("center", forceCenter(VIEWBOX.width / 2, VIEWBOX.height / 2))
      .force("collide", forceCollide<SimulationGraphNode>((node) => NODE_RADIUS[node.kind] + 7))
      .stop();

    for (let tick = 0; tick < SIMULATION_TICKS; tick += 1) simulation.tick();

    const positionedNodes = simulationNodes.map((node) => {
      const position = clampToViewBox(node);
      node.x = position.x;
      node.y = position.y;
      return node as PositionedNode;
    });
    const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
    const positionedLinks = model.links.map((link) => ({
      source: nodeById.get(link.source)!,
      target: nodeById.get(link.target)!,
    }));

    simulation.on("tick", () => {
      for (const node of positionedNodes) {
        const position = clampToViewBox(node);
        node.x = position.x;
        node.y = position.y;
      }
      setNodes([...positionedNodes]);
    });

    simulationRef.current = simulation;
    simulationNodesRef.current = positionedNodes;
    setNodes([...positionedNodes]);
    setLinks(positionedLinks);

    return () => {
      simulation.on("tick", null);
      simulation.stop();
      if (simulationRef.current === simulation) simulationRef.current = null;
    };
  }, [model]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const activeId = draggingIdRef.current;
      const svg = svgRef.current;
      if (!activeId || !svg) return;

      // jsdom returns null here, so drag coordinates are covered by the e2e
      // follow-up rather than a unit test.
      const inverseMatrix = svg.getScreenCTM()?.inverse();
      if (!inverseMatrix) return;

      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const svgPoint = point.matrixTransform(inverseMatrix);
      const node = simulationNodesRef.current.find((candidate) => candidate.id === activeId);
      if (!node) return;

      const position = clampToViewBox({ kind: node.kind, x: svgPoint.x, y: svgPoint.y });
      node.x = position.x;
      node.y = position.y;
      node.fx = position.x;
      node.fy = position.y;
      setNodes([...simulationNodesRef.current]);

      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reducedMotion) {
        simulationRef.current?.alphaTarget(DRAG_ALPHA_TARGET).restart();
      }
    };

    const handlePointerUp = () => {
      const activeId = draggingIdRef.current;
      if (!activeId) return;

      const node = simulationNodesRef.current.find((candidate) => candidate.id === activeId);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      simulationRef.current?.alphaTarget(0);
      draggingIdRef.current = null;
      setDraggingId(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      simulationRef.current?.stop();
    };
  }, []);

  const onNodePointerDown = (id: string, event: ReactPointerEvent<SVGGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    svgRef.current = event.currentTarget.ownerSVGElement;
    draggingIdRef.current = id;
    setDraggingId(id);

    const node = simulationNodesRef.current.find((candidate) => candidate.id === id);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
    }
  };

  return { nodes, links, draggingId, onNodePointerDown };
}
