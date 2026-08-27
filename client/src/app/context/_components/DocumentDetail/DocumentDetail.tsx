/* DocumentDetail — the right pane of the Project Context screen. Purely
   presentational: every piece of state comes from `useContextAuthoring` via
   props — no data fetching, no mutation calls here. Preview-only, per the
   lab assignment's own text (Reader + manual attach + "preview" — it never
   asks for in-app editing): three states — no selection (a placeholder,
   never a blank pane), loading, a named load error that leaves the rest of
   the page usable, and the rendered document (the vendored `Markdown`
   primitive — no `rehype-raw`, which is what keeps untrusted markdown safe
   to render as data). New file / New folder / Upload stay available from
   the toolbar (ContextView) — this pane just never offers an Edit mode. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Icon, Markdown, Skeleton } from "@devdigest/ui";
import type { DocumentDetailProps } from "../ContextView/types";
import { s } from "./styles";

export function DocumentDetail({
  selectedPath,
  document,
  isDocLoading,
  isDocError,
  docErrorMessage,
  reloadFromDisk,
}: DocumentDetailProps) {
  const t = useTranslations("context");

  // No selection -> the placeholder, never a blank pane (AC-3).
  if (!selectedPath) {
    return (
      <section style={s.pane}>
        <EmptyState icon="FileText" title={t("detail.placeholder")} />
      </section>
    );
  }

  if (isDocLoading) {
    return (
      <section style={s.pane}>
        <Skeleton height={240} />
      </section>
    );
  }

  // Unreadable document -> a named error that leaves the rest of the page
  // usable (AC-4) — this pane fails alone, the list stays interactive.
  if (isDocError || !document) {
    return (
      <section style={s.pane}>
        <ErrorState title={t("editor.loadError")} body={docErrorMessage} onRetry={reloadFromDisk} />
      </section>
    );
  }

  return (
    <section style={s.pane}>
      <header style={s.header}>
        <div style={s.headerRow}>
          <span style={s.pathValue} title={document.path}>
            {document.path}
          </span>
          <div style={s.usedBy}>
            <Icon.Users size={13} />
            <span>{t("detail.usedBy", { count: document.used_by })}</span>
          </div>
        </div>
      </header>

      <div style={s.previewBox}>
        <Markdown>{document.content}</Markdown>
      </div>
    </section>
  );
}
