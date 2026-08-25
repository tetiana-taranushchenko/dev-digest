import type { CSSProperties } from "react";
import type { BlastNodeKind } from "./graph-model";

export const NODE_COLORS = {
  // The design system has no violet semantic token; this is local to the
  // graph's changed-symbol encoding.
  symbol: "#8b5cf6",
  caller: "var(--info)",
  endpoint: "var(--ok)",
  cron: "var(--warn)",
} satisfies Record<BlastNodeKind, string>;

export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  svg: {
    width: "100%",
    height: "auto",
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  node: {
    cursor: "pointer",
  } satisfies CSSProperties,
  nodeLabel: {
    fill: "var(--text-secondary)",
    fontSize: 8.5,
    pointerEvents: "none",
    paintOrder: "stroke",
    stroke: "var(--bg-elevated)",
    strokeWidth: 3,
    strokeLinejoin: "round",
  } satisfies CSSProperties,
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: "6px 14px",
    padding: 0,
    margin: 0,
    listStyle: "none",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  legendDot: (kind: BlastNodeKind): CSSProperties => ({
    width: 9,
    height: 9,
    flexShrink: 0,
    borderRadius: "50%",
    background: NODE_COLORS[kind],
  }),
  hint: {
    margin: 0,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  truncated: {
    margin: 0,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  empty: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
