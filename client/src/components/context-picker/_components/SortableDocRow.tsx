"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { Icon } from "@devdigest/ui";
import type { ContextDocRow } from "../types";
import { s } from "../styles";
import { DocRow } from "./DocRow";

/** Drag-to-reorder wrapper for an attached row (AC-8 explicit order),
 *  following the `SkillsTab` precedent (`AgentEditor/_components/SkillsTab/
 *  SkillsTab.tsx:153-182`, @dnd-kit). */
export function SortableDocRow({
  row,
  disabled,
  onToggle,
  onPreview,
}: {
  row: ContextDocRow;
  disabled?: boolean;
  onToggle: () => void;
  onPreview: () => void;
}) {
  const t = useTranslations("context");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.path });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition: transition ?? undefined,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <DocRow
        row={row}
        disabled={disabled}
        onToggle={onToggle}
        onPreview={onPreview}
        dragHandle={
          <button
            type="button"
            aria-label={t("picker.dragHandle")}
            disabled={disabled}
            style={s.handle}
            {...attributes}
            {...listeners}
          >
            <Icon.Menu size={14} />
          </button>
        }
      />
    </div>
  );
}
