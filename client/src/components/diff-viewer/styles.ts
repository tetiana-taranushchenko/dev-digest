import type { CSSProperties } from "react";
import type { Severity } from "@devdigest/shared";
import type { Line } from "./helpers";

/** Co-located styles for the DiffViewer (extracted from inline styles). */
export const s = {
  list: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  empty: { padding: "24px", fontSize: 14, color: "var(--text-muted)", textAlign: "center" } satisfies CSSProperties,
  fileCard: {
    borderStyle: "solid",
    borderWidth: 1,
    borderColor: "var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileCardLarge: { borderColor: "var(--warn)" } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  filePathLarge: {
    color: "var(--warn)",
    background: "var(--warn-bg)",
    borderRadius: 3,
    padding: "1px 4px",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,
  fileMetaBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,
  largeFileBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--warn)",
    whiteSpace: "nowrap",
    flexShrink: 0,
  } satisfies CSSProperties,
  hunk: {
    fontSize: 12,
    lineHeight: "20px",
    color: "var(--accent-text)",
    background: "var(--accent-bg)",
    padding: "0 14px",
  } satisfies CSSProperties,
  lineNo: {
    width: 44,
    textAlign: "right",
    padding: "0 10px 0 0",
    color: "var(--text-muted)",
    userSelect: "none",
    flexShrink: 0,
  } satisfies CSSProperties,
  lineText: {
    flex: 1,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "var(--text-primary)",
    paddingRight: 12,
  } satisfies CSSProperties,
  findingRail: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "0 8px",
    flexShrink: 0,
  } satisfies CSSProperties,
} as const;

const FINDING_COLORS: Record<Severity, { color: string; background: string }> = {
  CRITICAL: { color: "var(--crit)", background: "var(--crit-bg)" },
  WARNING: { color: "var(--warn)", background: "var(--warn-bg)" },
  SUGGESTION: { color: "var(--sugg)", background: "var(--sugg-bg)" },
};

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}

/** Row background per line kind (add/del tinted, others transparent). */
export function lineRowFor(kind: Line["kind"]): CSSProperties {
  const background = kind === "add" ? "var(--code-add)" : kind === "del" ? "var(--code-del)" : "transparent";
  return { display: "flex", alignItems: "stretch", fontSize: 13, lineHeight: "20px", background };
}

/** A finding row uses the worst finding's severity, matching the instructor UI. */
export function lineRowWithFinding(kind: Line["kind"], severity: Severity): CSSProperties {
  const colors = FINDING_COLORS[severity];
  return {
    ...lineRowFor(kind),
    background: colors.background,
    borderLeft: `2px solid ${colors.color}`,
  };
}

export function findingButtonFor(severity: Severity): CSSProperties {
  const colors = FINDING_COLORS[severity];
  return {
    border: "none",
    background: "transparent",
    color: colors.color,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: "18px",
    padding: "0 2px",
    cursor: "pointer",
    textTransform: "lowercase",
    whiteSpace: "nowrap",
  };
}

/** Gutter sign colour per line kind. */
export function lineSignFor(kind: Line["kind"]): CSSProperties {
  return {
    width: 14,
    textAlign: "center",
    color: kind === "add" ? "var(--code-add-text)" : kind === "del" ? "var(--code-del-text)" : "var(--text-muted)",
    flexShrink: 0,
  };
}
