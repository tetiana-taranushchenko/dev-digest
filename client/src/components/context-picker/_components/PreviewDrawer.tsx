"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Drawer, Markdown, Skeleton } from "@devdigest/ui";
import type { ContextDocRow } from "../types";
import { useContextDocument } from "../../../lib/hooks/core";
import { ApiError } from "../../../lib/api";
import { s } from "../styles";
import { useFocusTrap } from "./useFocusTrap";

/**
 * Preview drawer for one document row — path, source, token estimate,
 * "used by N agents" when known, an unresolved (missing) indicator (AC-9),
 * the document's real rendered content (fetched on demand via the authoring
 * feature's read endpoint, `GET /repos/:id/context/document` — safe for any
 * discovered document, not just a writable one), and an Attach/Attached
 * toggle. Keyboard-operable: focus lands inside on open, Tab/Shift+Tab cycle
 * within it, Escape closes (see `useFocusTrap`).
 */
export function PreviewDrawer({
  row,
  repoId,
  onToggleAttach,
  onClose,
}: {
  row: ContextDocRow;
  repoId: string | null | undefined;
  onToggleAttach: (path: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("context");
  const containerRef = React.useRef<HTMLDivElement>(null);
  useFocusTrap(containerRef, onClose, true);

  // Only fetch the body for a resolved document — a missing/unresolved path
  // (AC-9) has nothing on disk to read.
  const docQuery = useContextDocument(repoId, row.resolved ? row.path : null);

  return (
    <div ref={containerRef} tabIndex={-1} style={{ outline: "none" }}>
      <Drawer
        width={520}
        title={row.path}
        subtitle={row.source ? t(`picker.source.${row.source}`) : undefined}
        onClose={onClose}
        footer={
          <Button
            kind={row.attached ? "secondary" : "primary"}
            icon={row.attached ? "Check" : "Plus"}
            onClick={() => onToggleAttach(row.path)}
          >
            {row.attached ? t("picker.attached") : t("picker.attach")}
          </Button>
        }
      >
        <div style={s.previewBody}>
          <div style={s.previewMeta}>
            {!row.resolved && (
              <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
                {t("picker.unresolved")}
              </Badge>
            )}
            <span>{t("picker.tokenCount", { tokens: row.tokens ?? 0 })}</span>
            {row.usedBy != null && <span>{t("picker.usedBy", { count: row.usedBy })}</span>}
          </div>

          {row.resolved && (
            <div style={s.previewContent}>
              {docQuery.isLoading && <Skeleton height={160} />}
              {docQuery.isError && (
                <div role="alert" style={s.previewError}>
                  {docQuery.error instanceof ApiError ? docQuery.error.message : t("editor.loadError")}
                </div>
              )}
              {docQuery.data && <Markdown>{docQuery.data.content}</Markdown>}
            </div>
          )}
        </div>
      </Drawer>
    </div>
  );
}
