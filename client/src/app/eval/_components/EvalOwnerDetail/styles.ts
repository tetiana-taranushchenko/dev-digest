import type { CSSProperties } from "react";

/** Co-located styles for EvalOwnerDetail (single-consumer tree — see
 *  `client/INSIGHTS.md`'s colocation rule; mirrors
 *  `EvalOverview/styles.ts` + `EvalsTab/styles.ts`). */
export const s = {
  page: { padding: "24px 32px 44px", maxWidth: 1000, margin: "0 auto" } satisfies CSSProperties,
  back: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
    padding: "4px 8px 4px 4px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    fontWeight: 600,
    cursor: "pointer",
  } satisfies CSSProperties,
  header: { display: "flex", alignItems: "flex-end", marginBottom: 18, gap: 12 } satisfies CSSProperties,
  h1: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h1Model: {
    fontSize: 11.5,
    fontWeight: 500,
    color: "var(--text-muted)",
    padding: "2px 7px",
    borderRadius: 5,
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-secondary)", marginTop: 3 } satisfies CSSProperties,

  alertBanner: {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: "11px 14px",
    borderRadius: 8,
    border: "1px solid var(--warn)",
    background: "var(--warn-bg)",
    marginBottom: 18,
  } satisfies CSSProperties,
  alertText: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,

  metricsRow: { display: "flex", gap: 14, marginBottom: 20 } satisfies CSSProperties,

  trendCard: { marginBottom: 20 } satisfies CSSProperties,
  trendHeader: { display: "flex", alignItems: "center", gap: 16, marginBottom: 12 } satisfies CSSProperties,
  legend: { marginLeft: "auto", display: "flex", gap: 14, fontSize: 11.5 } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 5, color: "var(--text-secondary)" } satisfies CSSProperties,
  legendSwatch: { width: 10, height: 2, borderRadius: 2 } satisfies CSSProperties,

  runsHeaderRow: { display: "flex", alignItems: "center", gap: 10, marginBottom: 4 } satisfies CSSProperties,
  runsHint: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  runsHintPush: { marginLeft: "auto" } satisfies CSSProperties,

  table: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    background: "var(--bg-elevated)",
    marginTop: 8,
  } satisfies CSSProperties,
  tableRow: {
    display: "grid",
    gridTemplateColumns: "24px 150px 60px 1fr 1fr 1fr 70px 70px",
    gap: 12,
    padding: "10px 16px",
    alignItems: "center",
    fontSize: 12.5,
  } satisfies CSSProperties,
  tableHeadRow: {
    background: "var(--bg-surface)",
    borderBottom: "1px solid var(--border)",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  tableBodyRow: { borderTop: "1px solid var(--border)", cursor: "pointer" } satisfies CSSProperties,
  tableBodyRowSelected: { background: "var(--bg-hover)" } satisfies CSSProperties,
  ranAtCell: { fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)", fontSize: 11.5 } satisfies CSSProperties,
  versionCell: { fontFamily: "var(--font-mono, monospace)", color: "var(--accent-text)" } satisfies CSSProperties,
  passCell: { fontWeight: 600 } satisfies CSSProperties,
  costCell: { fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary)" } satisfies CSSProperties,

  miniMetric: { display: "flex", alignItems: "center", gap: 7 } satisfies CSSProperties,
  miniMetricBar: { flex: 1 } satisfies CSSProperties,
  miniMetricValue: { fontSize: 11, color: "var(--text-secondary)", width: 30, textAlign: "right" } satisfies CSSProperties,
} as const;
