import type { CSSProperties } from "react";
import type { RiskLevel, RiskSeverity } from "@devdigest/shared";

/** Per-level/severity colour, always paired with a text label elsewhere
 *  (never colour alone — Accessibility NFR). */
export const RISK_TONE: Record<RiskLevel | RiskSeverity, { color: string; bg: string }> = {
  low: { color: "var(--ok)", bg: "var(--ok-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  high: { color: "var(--crit)", bg: "var(--crit-bg)" },
};

/** Co-located styles for BriefSummaryPanel / RiskAreasPanel / ReviewFocusPanel. */
export const s = {
  card: {
    background: "var(--bg-card-highlight)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 18,
  } satisfies CSSProperties,
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,

  // ---- Summary ----
  what: {
    fontSize: 15,
    fontWeight: 600,
    color: "var(--text-primary)",
    lineHeight: 1.5,
    marginBottom: 6,
  } satisfies CSSProperties,
  why: {
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
  riskLevelBadgeWrap: { display: "inline-flex" } satisfies CSSProperties,

  // ---- Verdict row (merged in by explicit product direction, 2026-08-29 —
  // see BriefVerdictInfo's doc comment) — visually mirrors VerdictBanner's
  // own icon-box/label/score-column styles for consistency with the
  // Findings-tab rendering of the same data. ----
  verdictRow: { display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 10 } satisfies CSSProperties,
  verdictIconBox: (bg: string, color: string): CSSProperties => ({
    width: 34,
    height: 34,
    borderRadius: 8,
    display: "grid",
    placeItems: "center",
    background: bg,
    color,
    flexShrink: 0,
  }),
  verdictMain: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  verdictTitleRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } satisfies CSSProperties,
  verdictLabel: (color: string): CSSProperties => ({ fontSize: 15, fontWeight: 700, color }),

  usage: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 8,
    display: "flex",
    gap: 8,
  } satisfies CSSProperties,

  emptyText: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- Risk Areas ----
  riskList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  riskRow: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  riskHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "10px 12px",
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  chevron: (expanded: boolean): CSSProperties => ({
    flexShrink: 0,
    transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
    transition: "transform 0.15s ease",
    color: "var(--text-muted)",
  }),
  severityLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    padding: "2px 8px",
    borderRadius: 5,
    flexShrink: 0,
  } satisfies CSSProperties,
  riskTitle: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  riskBody: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "0 12px 12px 36px",
  } satisfies CSSProperties,
  riskExplanation: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    margin: 0,
  } satisfies CSSProperties,
  fileRefs: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- Review Focus ----
  focusList: { display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  focusItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    background: "none",
    border: "1px solid transparent",
    borderRadius: 6,
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  focusItemStatic: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    padding: "8px 10px",
    border: "1px solid transparent",
    borderRadius: 6,
    textAlign: "left",
  } satisfies CSSProperties,
  focusIcon: { flexShrink: 0, marginTop: 2, color: "var(--text-muted)" } satisfies CSSProperties,
  focusContent: { display: "flex", flexDirection: "column", gap: 2 } satisfies CSSProperties,
  focusFile: { fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  focusReason: { fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4 } satisfies CSSProperties,
  notInDiff: { fontSize: 11.5, color: "var(--text-muted)", fontStyle: "italic" } satisfies CSSProperties,
} as const;
