import type React from "react";

/** Co-located styles for ContextView (the shell + left pane, T11) and
 *  `ContextDocRow` (single-consumer tree). Two-pane master-detail layout:
 *  `body`/`listPane`/`detailPane` lay the flat list and `DocumentDetail`
 *  (T10) side by side. */
export const s = {
  page: { padding: 28, maxWidth: 1280, margin: "0 auto" },
  header: { display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 20 },
  headerText: { flex: 1, minWidth: 0 },
  /** Small, quiet uppercase label — "PROJECT CONTEXT" reads as a section
   *  heading, not a page-dominating title. */
  h1: {
    fontSize: 11,
    lineHeight: 1.3,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-secondary)",
    margin: 0,
  },
  freshness: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    color: "var(--text-muted)",
    fontSize: 12,
    marginTop: 10,
    flexWrap: "wrap",
  },
  listToolbar: { display: "flex", gap: 4, alignItems: "center", marginBottom: 10 },
  hiddenInput: { display: "none" },
  inlineNote: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "9px 13px",
    marginBottom: 14,
    border: "1px solid var(--border)",
    borderRadius: 7,
    background: "var(--bg-elevated)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  inlineNoteError: {
    border: "1px solid var(--crit)",
    background: "var(--crit-bg)",
  },
  unavailable: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "11px 13px",
    marginBottom: 18,
    border: "1px solid var(--crit)",
    borderRadius: 7,
    background: "var(--crit-bg)",
    color: "var(--text-secondary)",
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  unavailableIcon: { flexShrink: 0, marginTop: 2, color: "var(--crit)" },
  unavailableStrong: { color: "var(--text-primary)", fontWeight: 700 },
  body: { display: "flex", gap: 0, alignItems: "stretch", marginTop: 18, minHeight: 480 },
  /** The left column is its own quiet card — a subtly-elevated panel
   *  (never plain white/light-gray, this is a dark theme) that visually
   *  separates the file list from the black detail pane on the right. */
  listPane: {
    flex: "0 0 300px",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-elevated)",
    borderRadius: 10,
    padding: 16,
  },
  detailPane: { flex: 1, minWidth: 0, padding: "4px 0 4px 28px" },
  listScroll: { flex: 1, overflowY: "auto", marginTop: 2 },
  list: { display: "flex", flexDirection: "column", gap: 1 },
  row: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    gap: 9,
    padding: "7px 9px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
    cursor: "pointer",
  },
  rowSelected: {
    background: "var(--bg-hover)",
  },
  rowIcon: { flexShrink: 0, marginTop: 1, color: "var(--text-muted)" },
  rowMain: { flex: 1, minWidth: 0 },
  fileName: {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  folder: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
} satisfies Record<string, React.CSSProperties>;
