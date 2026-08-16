import type { CSSProperties } from "react";

/** Co-located styles for IntentPanel (and its ConfidenceBadge / ScopeList subcomponents). */
export const s = {
  summary: {
    fontSize: 15,
    fontStyle: "italic",
    color: "var(--text-primary)",
    lineHeight: 1.5,
    marginBottom: 16,
  } satisfies CSSProperties,
  scopeColumns: {
    display: "flex",
    gap: 24,
    flexWrap: "wrap",
    marginBottom: 14,
  } satisfies CSSProperties,
  sources: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,

  // ---- ScopeList ----
  scopeColumn: { flex: "1 1 240px", minWidth: 220 } satisfies CSSProperties,
  scopeHeading: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  scopeList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  scopeListItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    fontSize: 13.5,
    color: "var(--text-secondary)",
    lineHeight: 1.45,
  } satisfies CSSProperties,
  scopeListItemIcon: { marginTop: 2, flexShrink: 0 } satisfies CSSProperties,
} as const;
