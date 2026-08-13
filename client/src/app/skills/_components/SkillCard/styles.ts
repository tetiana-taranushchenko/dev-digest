import type { CSSProperties } from "react";

/** Co-located styles for SkillCard (mirrors AgentCard's styles.ts). */
export const s = {
  card: (active: boolean, enabled: boolean, flagged?: boolean): CSSProperties => ({
    padding: 14,
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid " + (flagged ? "var(--crit)" : active ? "var(--border-strong)" : "var(--border)"),
    background: flagged ? "var(--crit-bg)" : active ? "var(--bg-hover)" : "var(--bg-elevated)",
    opacity: flagged ? 1 : enabled ? 1 : 0.6,
    marginBottom: 10,
  }),
  headerRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  iconBox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    background: "var(--accent-bg)",
    color: "var(--accent)",
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    fontSize: 14,
    fontWeight: 600,
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-muted)",
    margin: "8px 0",
    lineHeight: 1.4,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  statsLine: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 8,
  } satisfies CSSProperties,
} as const;
