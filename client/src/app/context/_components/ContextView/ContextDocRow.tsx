import React from "react";
import { Icon } from "@devdigest/ui";
import type { SpecFile } from "@devdigest/shared";
import { splitDocPath } from "./helpers";
import { s } from "./styles";

/**
 * One discovered document, shown by name only — a plain, uncluttered row
 * matching the design (icon + file name, no folder/source/token/used-by
 * metadata cluttering the list; that detail lives in `DocumentDetail`, T10,
 * once a row is selected). A real `<button>` so the row is keyboard-operable
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
      </div>
    </button>
  );
}
