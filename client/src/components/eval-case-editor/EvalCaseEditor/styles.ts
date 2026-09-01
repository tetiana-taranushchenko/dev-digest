import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseEditor (single-consumer tree — see
 *  `client/INSIGHTS.md` 2026-08-04 colocation rule). */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 20, padding: "20px 24px" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 16 } satisfies CSSProperties,
  footerActions: { display: "flex", gap: 10, marginLeft: "auto" } satisfies CSSProperties,
  runOnSaveLabel: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  ownerRow: { display: "flex", gap: 10 } satisfies CSSProperties,
  ownerAlert: { fontSize: 12, color: "var(--crit)", marginTop: 8 } satisfies CSSProperties,
  inputTabsWrap: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    overflow: "hidden",
  } satisfies CSSProperties,
  tabBody: { padding: 12, background: "var(--bg-surface)" } satisfies CSSProperties,
  metaWrap: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  metaPreview: {
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    minHeight: 180,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  invalidNote: { fontSize: 12, color: "var(--crit)", marginTop: 8 } satisfies CSSProperties,
  runResult: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
  } satisfies CSSProperties,
  runResultPass: { borderColor: "var(--ok)", background: "var(--ok-bg)" } satisfies CSSProperties,
  runResultFail: { borderColor: "var(--crit)", background: "var(--crit-bg)" } satisfies CSSProperties,
  runResultLabel: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  runResultSummary: { fontSize: 12.5, color: "var(--text-secondary)" } satisfies CSSProperties,
} as const;
