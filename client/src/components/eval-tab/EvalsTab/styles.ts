import type { CSSProperties } from "react";

/** Co-located styles for EvalsTab (single-consumer tree — see
 *  `client/INSIGHTS.md` 2026-08-04 colocation rule; mirrors
 *  `EvalCaseEditor/styles.ts`). */
export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 } satisfies CSSProperties,
  metricsRow: { display: "flex", gap: 12 } satisfies CSSProperties,
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
  passCount: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
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
  caseInfo: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } satisfies CSSProperties,
  caseName: { fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  caseSummary: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  orphanBadge: { fontSize: 11.5, fontWeight: 600, color: "var(--crit)" } satisfies CSSProperties,
  caseActions: { display: "flex", gap: 6, flexShrink: 0 } satisfies CSSProperties,
} as const;
