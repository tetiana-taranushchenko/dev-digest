import type { CSSProperties } from "react";

/** Co-located styles for FileTab. */
export const s = {
  fileRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  fileButton: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 14px",
    borderRadius: 7,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties,
  fileInputHidden: {
    position: "absolute",
    inset: 0,
    opacity: 0,
    cursor: "pointer",
    width: "100%",
  } satisfies CSSProperties,
  fileName: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  actions: { display: "flex", justifyContent: "flex-end", marginTop: 16 } satisfies CSSProperties,
} as const;
