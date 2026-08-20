import type { CSSProperties } from "react";
import type { BlastState } from "@devdigest/shared";

/** Co-located styles for BlastRadiusPanel and its SymbolRow / CallerRow subcomponents. */
export const s = {
  card: {
    background: "var(--bg-card-highlight)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 18,
  } satisfies CSSProperties,
  viewToggle: { display: "inline-flex", gap: 6 } satisfies CSSProperties,

  /** Colored per-state so `partial`/`degraded` read as visually distinct from
   *  both the neutral EmptyState and a normal `ok` render (REQ-4). */
  stateNotice: (state: Extract<BlastState, "partial" | "degraded">): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 14px",
    borderRadius: 8,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 1.5,
    color: state === "degraded" ? "var(--crit)" : "var(--warn)",
    background: state === "degraded" ? "var(--crit-bg)" : "var(--warn-bg)",
    border: `1px solid ${state === "degraded" ? "var(--crit)" : "var(--warn)"}`,
  }),
  stateNoticeTitle: {
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    fontSize: 12,
  } satisfies CSSProperties,

  noDownstream: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,

  /** Compact metadata line — symbols/callers/endpoints/crons counts (REQ-4:
   *  visible even in the partial/degraded case, not just the happy path). */
  statsRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  statItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,

  symbolList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  symbolRow: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  symbolHeader: {
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
  symbolName: { fontSize: 13.5, fontWeight: 600 } satisfies CSSProperties,
  symbolFile: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  callerCount: { marginLeft: "auto", fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,

  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "0 12px 12px 36px",
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 13,
  } satisfies CSSProperties,
  callerIcon: { flexShrink: 0, color: "var(--text-muted)" } satisfies CSSProperties,
  badgeRow: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4 } satisfies CSSProperties,
  badgeRowLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginRight: 2,
  } satisfies CSSProperties,
  /** "+N more" / "show less" toggle appended to a truncated badge row —
   *  deliberately unstyled-button-like so it reads as a link, not a Badge. */
  badgeToggle: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 6px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    background: "none",
    border: "none",
    cursor: "pointer",
  } satisfies CSSProperties,

  /** "Prior PRs touching these files" collapsible row — bottom of the card. */
  priorPrsRow: {
    marginTop: 14,
    paddingTop: 14,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  priorPrsHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: 0,
    background: "none",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  priorPrsList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 8,
    paddingLeft: 22,
  } satisfies CSSProperties,
  priorPrsItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
    textDecoration: "none",
  } satisfies CSSProperties,
  priorPrsAge: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
