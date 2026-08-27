import type React from "react";

/** Co-located styles for DocumentDetail (T10, single-consumer tree). */
export const s = {
  pane: { display: "flex", flexDirection: "column", gap: 16, minWidth: 0, background: "transparent" },
  header: { display: "flex", flexDirection: "column", gap: 8 },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  },
  pathValue: {
    fontSize: 15,
    fontWeight: 650,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  usedBy: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  previewBox: { padding: "4px 0" },
} satisfies Record<string, React.CSSProperties>;
