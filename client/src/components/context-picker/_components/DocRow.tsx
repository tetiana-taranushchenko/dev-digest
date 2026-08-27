"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Checkbox } from "@devdigest/ui";
import type { ContextDocRow } from "../types";
import { splitDocPath, SOURCE_BADGE_COLOR } from "../helpers";
import { s } from "../styles";

/** One document row: attach checkbox, path, source badge, per-document token
 *  estimate (AC-10), an unresolved (missing, AC-9) indicator, and a Preview
 *  button. `dragHandle` is supplied by `SortableDocRow` for the attached
 *  (orderable) list only — omitted for the static unattached checklist. */
export function DocRow({
  row,
  dragHandle,
  disabled,
  onToggle,
  onPreview,
}: {
  row: ContextDocRow;
  dragHandle?: React.ReactNode;
  disabled?: boolean;
  onToggle: () => void;
  onPreview: () => void;
}) {
  const t = useTranslations("context");
  const { folder, fileName } = splitDocPath(row.path);
  return (
    <div style={row.resolved ? s.row : s.rowUnresolved}>
      {dragHandle ?? <span style={s.handleSpacer} />}
      <span style={disabled ? { pointerEvents: "none", opacity: 0.5 } : undefined}>
        <Checkbox checked={row.attached} onChange={onToggle} />
      </span>
      <span style={s.nameCol} title={row.path}>
        <span style={s.fileName}>{fileName}</span>
        {folder && <span style={s.folder}>{folder}</span>}
      </span>
      {row.source ? (
        <Badge
          style={s.sourceBadge}
          color={SOURCE_BADGE_COLOR[row.source].color}
          bg={SOURCE_BADGE_COLOR[row.source].bg}
        >
          {t(`picker.source.${row.source}`)}
        </Badge>
      ) : (
        <span style={s.sourceBadge} />
      )}
      <Badge mono style={s.tokenBadge}>
        {t("picker.tokenCount", { tokens: row.tokens ?? 0 })}
      </Badge>
      {!row.resolved && (
        <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertTriangle">
          {t("picker.unresolved")}
        </Badge>
      )}
      <Button kind="ghost" size="sm" icon="Eye" onClick={onPreview}>
        {t("picker.preview")}
      </Button>
    </div>
  );
}
