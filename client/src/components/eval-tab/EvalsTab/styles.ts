import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab (single-consumer tree — see
 *  `client/INSIGHTS.md` 2026-08-04 colocation rule; mirrors
 *  `EvalCaseEditor/styles.ts`). */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20 } satisfies CSSProperties,
  metricsBlock: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  metricsHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } satisfies CSSProperties,
  metricsHeading: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text-muted)",
    letterSpacing: "0.05em",
  } satisfies CSSProperties,
  dashboardLink: {
    fontSize: 12.5,
    fontWeight: 600,
    color: "var(--accent-text)",
    textDecoration: "none",
  } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 12 } satisfies CSSProperties,
  scoringExplainer: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  hint: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  } satisfies CSSProperties,
  headingCol: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  heading: { fontSize: 15, fontWeight: 700, color: "var(--text-primary)" } satisfies CSSProperties,
  passCount: {
    display: "inline-flex",
    alignSelf: "flex-start",
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--ok)",
    background: "var(--ok-bg)",
    padding: "1px 7px",
    borderRadius: 99,
  } satisfies CSSProperties,
  headerActions: { display: "flex", gap: 8 } satisfies CSSProperties,
  progressWrap: { padding: "2px 0" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  caseRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  caseLeft: { display: "flex", flex: "1 1 auto", alignItems: "flex-start", gap: 10, minWidth: 0 } satisfies CSSProperties,
  caseStatusIcon: { flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  caseInfo: { display: "flex", flex: "1 1 auto", flexDirection: "column", gap: 4, minWidth: 0 } satisfies CSSProperties,
  caseNameRow: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } satisfies CSSProperties,
  caseName: {
    flex: "1 1 0%",
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  } satisfies CSSProperties,
  caseKindBadge: { flexShrink: 0 } satisfies CSSProperties,
  caseSummary: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  orphanBadge: { fontSize: 11.5, fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,
  /* Fixed-width column (reserved even when empty — a `must_not_flag` case
   * has no source severity/category) so `caseActions` lines up at the same
   * x-offset across every row, regardless of tag content. The gap between
   * this column and `caseNameRow`'s badge grows with `caseLeft`'s flex-grow
   * as the tab widens (no more `wrap.maxWidth` cap). */
  caseTag: {
    width: 170,
    flexShrink: 0,
    textAlign: "right",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  } satisfies CSSProperties,
  caseRight: { display: "flex", alignItems: "center", gap: 16, flexShrink: 0 } satisfies CSSProperties,
  caseActions: { display: "flex", gap: 6, flexShrink: 0, alignItems: "center" } satisfies CSSProperties,
} as const;
