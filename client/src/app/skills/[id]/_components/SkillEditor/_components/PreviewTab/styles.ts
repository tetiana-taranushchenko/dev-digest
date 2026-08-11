import type { CSSProperties } from "react";

/** Co-located styles for PreviewTab. */
export const s = {
  wrap: { maxWidth: 760, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  caption: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  rendered: {
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--bg-elevated)",
    padding: 20,
    fontSize: 14,
  } satisfies CSSProperties,
  untrustedBox: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  wrapperTag: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
