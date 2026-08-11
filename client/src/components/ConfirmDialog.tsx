"use client";

import React from "react";
import { Button, IconBtn } from "@devdigest/ui";

/** App-styled confirm dialog (replaces window.confirm's native browser
 *  popup). A standalone overlay (not the vendored Modal) so the whole
 *  surface stays one flat panel — no divider lines between title/body/
 *  footer, no separate footer background. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: {
  title?: React.ReactNode;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", zIndex: 50, padding: 28 }}>
      <div
        onClick={onCancel}
        style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", animation: "ddfadein .15s ease" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "relative",
          width: 480,
          maxWidth: "100%",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 14,
          boxShadow: "var(--shadow-modal)",
          padding: "20px 24px 22px",
          animation: "ddpop .18s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{title}</div>
          <IconBtn icon="X" label="Close" onClick={onCancel} />
        </div>
        <div style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 22 }}>
          {message}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button kind={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
