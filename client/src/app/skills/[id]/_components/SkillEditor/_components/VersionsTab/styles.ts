import type { CSSProperties } from "react";

/** Co-located styles for VersionsTab. */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  h2: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "12px 14px",
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  rowBody: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  summary: { fontSize: 14, color: "var(--text-primary)" } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 } satisfies CSSProperties,
  rowActions: { display: "flex", gap: 8, flexShrink: 0 } satisfies CSSProperties,
  footer: { fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  emptyNote: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  diffBody: {
    padding: 16,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12.5,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  } satisfies CSSProperties,
  diffSame: { color: "var(--text-secondary)" } satisfies CSSProperties,
  diffAdded: { color: "var(--ok)", background: "rgba(79, 201, 122, 0.08)" } satisfies CSSProperties,
  diffRemoved: { color: "var(--crit)", background: "rgba(201, 79, 79, 0.08)" } satisfies CSSProperties,
} as const;
