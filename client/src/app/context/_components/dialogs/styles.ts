import type React from "react";

/** Co-located styles for `NamePromptDialog` — deliberately mirrors
 *  `client/src/components/ConfirmDialog.tsx`'s overlay/panel shape (flat
 *  panel, no divider lines) so the New file/New folder prompt reads as the
 *  same dialog language as the reused `ConfirmDialog` instances. */
export const s = {
  overlay: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    zIndex: 50,
    padding: 28,
  },
  backdrop: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    animation: "ddfadein .15s ease",
  },
  panel: {
    position: "relative",
    width: 420,
    maxWidth: "100%",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: 14,
    boxShadow: "var(--shadow-modal)",
    padding: "20px 24px 22px",
    animation: "ddpop .18s ease",
  },
  title: { fontSize: 16, fontWeight: 700, marginBottom: 14 },
  error: {
    fontSize: 12.5,
    color: "var(--crit)",
    marginTop: -10,
    marginBottom: 16,
  },
  actions: { display: "flex", justifyContent: "flex-end", gap: 10 },
} satisfies Record<string, React.CSSProperties>;
