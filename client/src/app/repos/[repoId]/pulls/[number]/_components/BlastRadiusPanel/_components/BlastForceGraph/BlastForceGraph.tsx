"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { DownstreamImpact, PrFile } from "@devdigest/shared";
import { resolveCallerDestination } from "../../helpers";
import { DENSE_LABEL_THRESHOLD, NODE_RADIUS, VIEWBOX } from "./constants";
import { buildBlastGraph } from "./graph-model";
import { NODE_COLORS, s } from "./styles";
import { useForceLayout } from "./useForceLayout";

export interface BlastForceGraphProps {
  downstream: DownstreamImpact[];
  files: PrFile[];
  repoId: string;
  prNumber: number;
  repoFullName?: string | null;
  headSha?: string | null;
}

export function BlastForceGraph({
  downstream,
  files,
  repoId,
  prNumber,
  repoFullName,
  headSha,
}: BlastForceGraphProps) {
  const t = useTranslations("blast");
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const model = useMemo(() => buildBlastGraph(downstream), [downstream]);
  const { nodes, links, draggingId, onNodePointerDown } = useForceLayout(model);

  if (model.nodes.length === 0) {
    return <p style={s.empty}>{t("graph.empty")}</p>;
  }

  const selectedSubgraph = new Set<string>();
  if (selectedId) {
    selectedSubgraph.add(selectedId);
    for (const link of model.links) {
      if (link.source === selectedId) selectedSubgraph.add(link.target);
      if (link.target === selectedId) selectedSubgraph.add(link.source);
    }
  }

  const symbols = model.nodes.filter((node) => node.kind === "symbol").length;
  const callers = model.nodes.filter((node) => node.kind === "caller").length;
  const facts = model.nodes.filter((node) => node.kind === "endpoint" || node.kind === "cron").length;
  const hasCron = model.nodes.some((node) => node.kind === "cron");
  const dense = model.nodes.length > DENSE_LABEL_THRESHOLD;

  return (
    <div style={s.wrap}>
      <svg
        role="img"
        aria-label={t("graph.ariaLabel")}
        viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={s.svg}
      >
        <title>{t("graph.ariaLabel")}</title>
        <desc>{t("graph.description", { symbols, callers, facts })}</desc>

        {links.map((link) => {
          const highlighted =
            !selectedId || (selectedSubgraph.has(link.source.id) && selectedSubgraph.has(link.target.id));
          const opacity = !selectedId ? 0.16 : highlighted ? 0.55 : 0.04;
          return (
            <line
              key={`${link.source.id}->${link.target.id}`}
              x1={link.source.x}
              y1={link.source.y}
              x2={link.target.x}
              y2={link.target.y}
              stroke="var(--border-strong)"
              strokeWidth={1}
              opacity={opacity}
            />
          );
        })}

        {nodes.map((node) => {
          const radius = NODE_RADIUS[node.kind];
          const highlighted = !selectedId || selectedSubgraph.has(node.id);
          const showLabel = !dense || node.kind === "symbol" || hoveredId === node.id || selectedId === node.id;
          return (
            <g
              key={node.id}
              transform={`translate(${node.x} ${node.y})`}
              opacity={highlighted ? 1 : 0.25}
              style={s.node}
              onPointerEnter={() => setHoveredId(node.id)}
              onPointerLeave={() => setHoveredId((current) => (current === node.id ? null : current))}
              onPointerDown={(event) => onNodePointerDown(node.id, event)}
              onClick={() => {
                if (node.kind === "caller") {
                  const destination = resolveCallerDestination({
                    caller: node.caller!,
                    files,
                    repoId,
                    prNumber,
                    repoFullName,
                    headSha,
                  });
                  if (destination.kind === "in-app") {
                    router.push(destination.route);
                  } else if (destination.url) {
                    window.open(destination.url, "_blank", "noopener,noreferrer");
                  }
                  return;
                }

                setSelectedId((current) => (current === node.id ? null : node.id));
              }}
            >
              <title>{node.title}</title>
              <circle r={12} fill="transparent" />
              <circle
                r={radius}
                fill={NODE_COLORS[node.kind]}
                stroke={draggingId === node.id ? "var(--text-primary)" : "none"}
                strokeWidth={2}
              />
              {showLabel && (
                <text className="mono" textAnchor="middle" dy={radius + 10} style={s.nodeLabel}>
                  {node.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <ul style={s.legend}>
        {(["symbol", "caller", "endpoint"] as const).map((kind) => (
          <li key={kind} style={s.legendItem}>
            <span aria-hidden style={s.legendDot(kind)} />
            {t(`graph.legend.${kind}`)}
          </li>
        ))}
        {hasCron && (
          <li style={s.legendItem}>
            <span aria-hidden style={s.legendDot("cron")} />
            {t("graph.legend.cron")}
          </li>
        )}
      </ul>

      <p style={s.hint}>{t("graph.a11yHint")}</p>
      {model.hiddenNodeCount > 0 && (
        <p style={s.truncated}>{t("graph.truncated", { count: model.hiddenNodeCount })}</p>
      )}
    </div>
  );
}
