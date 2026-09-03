import type { CSSProperties } from "react";

/** Co-located styles for EvalOverview (single-consumer tree — see
 *  `client/INSIGHTS.md`'s colocation rule; mirrors
 *  `AgentsListView/styles.ts` + `EvalsTab/styles.ts`). */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1100, margin: "0 auto" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    marginBottom: 20,
  } satisfies CSSProperties,
  h1: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: { fontSize: 14, color: "var(--text-secondary)", marginTop: 4 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  identity: { display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 } satisfies CSSProperties,
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  identityText: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  meta: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  metrics: { display: "flex", alignItems: "center", gap: 22, flexShrink: 0 } satisfies CSSProperties,
  metric: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, minWidth: 44 } satisfies CSSProperties,
  metricLabel: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  metricValue: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
} as const;
