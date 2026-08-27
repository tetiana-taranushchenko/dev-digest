import type React from "react";

/** Co-located styles for `DocumentList` (T11, new left-pane wrapper). The
 *  row list itself reuses `ContextView/styles.ts`'s `s.list`/`s.row` — this
 *  file only owns the scroll wrapper around it, since `ContextDocRow` stays
 *  in `ContextView/` (owned by the previous single-pane feature). */
export const s = {
  pane: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 },
} satisfies Record<string, React.CSSProperties>;
