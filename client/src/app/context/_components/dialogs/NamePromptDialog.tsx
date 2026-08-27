/* NamePromptDialog — the New file/New folder name prompt (T11,
   `docs/plans/project-context-authoring.md`, AC-12/AC-13). No such component
   existed before this plan; it deliberately mirrors
   `client/src/components/ConfirmDialog.tsx`'s overlay/panel shape (reused
   elsewhere in this screen for the unsaved-changes and Re-index
   confirmations) but adds the one thing `ConfirmDialog` doesn't have: a
   controlled text input. Purely presentational — the caller (`ContextView`)
   owns the submitted name, the client-side format precheck, and the
   server-returned error text. */
"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, IconBtn, TextInput } from "@devdigest/ui";
import { s } from "./styles";

export function NamePromptDialog({
  kind,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  kind: "file" | "folder";
  submitting: boolean;
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("context");
  const tCommon = useTranslations("common");
  const [name, setName] = useState("");

  const promptLabel = kind === "file" ? t("create.filePrompt") : t("create.folderPrompt");
  const actionLabel = kind === "file" ? t("toolbar.newFile") : t("toolbar.newFolder");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || submitting) return;
    onSubmit(name.trim());
  };

  return (
    <div
      style={s.overlay}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div onClick={onCancel} style={s.backdrop} />
      <form role="dialog" aria-modal="true" aria-label={actionLabel} onSubmit={submit} style={s.panel}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ ...s.title, flex: 1 }}>{actionLabel}</div>
          <IconBtn icon="X" label={tCommon("actions.close")} onClick={onCancel} />
        </div>
        <FormField label={promptLabel}>
          <TextInput
            value={name}
            onChange={setName}
            aria-label={promptLabel}
            placeholder={promptLabel}
            autoFocus
          />
        </FormField>
        {error && (
          <div role="alert" style={s.error}>
            {error}
          </div>
        )}
        <div style={s.actions}>
          <Button kind="secondary" type="button" onClick={onCancel}>
            {tCommon("actions.cancel")}
          </Button>
          <Button kind="primary" type="submit" loading={submitting} disabled={!name.trim() || submitting}>
            {actionLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
