"use client";

import React from "react";
import { Modal, Button } from "@devdigest/ui";

/** App-styled confirm dialog (replaces window.confirm's native browser
 *  popup, which doesn't match the app's dark theme). Cancel/Confirm sit
 *  bottom-right in the footer, mirroring the native dialog's button layout. */
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
    <Modal
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button kind="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button kind={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div style={{ padding: "20px 24px", fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {message}
      </div>
    </Modal>
  );
}
