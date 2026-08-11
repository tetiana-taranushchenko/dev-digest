import type { CSSProperties } from "react";

/** Co-located styles for the SkillEditor shell. */
export const s = {
  // minHeight: 0 is required — a flex column child otherwise refuses to
  // shrink below its content size, so the tall body Textarea (or a long
  // markdown preview) grows the WHOLE page instead of scrolling inside
  // `body` below, which pushes the sibling skill-list panel's bottom off
  // the visible viewport with no way to scroll to it.
  wrap: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } satisfies CSSProperties,
  tabsBar: { marginTop: 14 } satisfies CSSProperties,
  body: { flex: 1, overflow: "auto", padding: 28 } satisfies CSSProperties,
} as const;
