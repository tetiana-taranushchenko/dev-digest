import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { splitDocPath } from "./helpers";
import { s } from "./styles";

/**
 * One discovered document with the listing metadata required by the original
 * Project Context contract (source, token estimate, and used-by count). A real
 * `<button>` keeps the whole row keyboard-operable
 * (tab + Enter/Space) with no extra wiring, and the selected row is visually
 * marked via `s.rowSelected` (AC-2) — a background highlight only, no border.
 * Read-only listing metadata — attach/detach lives in the Agent/Skill editors
 * (T15/T16) via the shared `ContextDocPicker`, not here.
 */
export function ContextDocRow({
  file,
  selected,
  onSelect,
}: {
  file: SpecFile;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("context");
  const { folder, fileName } = splitDocPath(file.path);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      style={selected ? { ...s.row, ...s.rowSelected } : s.row}
    >
      <Icon.FileText size={15} style={s.rowIcon} />
      <div style={s.rowMain}>
        <div style={s.fileName} title={file.path}>
          {fileName}
        </div>
        {folder && <div style={s.folder}>{folder}</div>}
        <div style={s.rowMetadata}>
          <span>{t(`picker.source.${file.source}`)}</span>
          {file.tokens != null && <span>{t("picker.tokenCount", { tokens: file.tokens })}</span>}
          {file.used_by != null && <span>{t("picker.usedBy", { count: file.used_by })}</span>}
        </div>
      </div>
    </button>
  );
}
