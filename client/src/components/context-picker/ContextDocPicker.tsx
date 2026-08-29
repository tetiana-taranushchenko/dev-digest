"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { Badge, Skeleton } from "@devdigest/ui";
import { buildRows, isOverCap, totalAttachedTokens } from "./helpers";
import { s } from "./styles";
import type { ContextDocPickerProps, ContextDocRow } from "./types";
import { SortableDocRow } from "./_components/SortableDocRow";
import { PreviewDrawer } from "./_components/PreviewDrawer";

/**
 * ContextDocPicker — shared attach UI (T12). Renders the document checklist,
 * per-document token estimate (AC-10), a running total, an over-cap warning
 * (text label, not colour alone — AC-11 + NFR accessibility), an optional
 * map-reduce cost-repeats note (AC-11), an unresolved-path row state (AC-9),
 * drag-to-reorder for the attached set (AC-8), and a keyboard-operable
 * Preview drawer. Consumed by the Agent Editor Context tab (T15) and the
 * Skill Editor context section (T16) — data fetching and the ordered/
 * combined `attached` set are the caller's responsibility; this component
 * only renders what it's given and reports changes via `onChange`.
 *
 * The running-total summary bar (token total + over-cap badge/hint) is
 * computed from whatever `attached` it's given, which for the Agent Editor
 * is direct-only (see that tab's own doc comment). A consumer that renders
 * its own — more complete — combined total instead should pass
 * `hideSummary` to avoid stacking two near-identical "N tokens total" bars.
 */
export function ContextDocPicker({
  repoId,
  documents,
  attached,
  onChange,
  tokenCap,
  mapReduce = false,
  loading = false,
  loadError = false,
  disabled = false,
  hideSummary = false,
}: ContextDocPickerProps) {
  const t = useTranslations("context");
  const [previewPath, setPreviewPath] = React.useState<string | null>(null);
  // Purely local, display-only reorder for the unattached list — there is no
  // persisted order for documents that aren't attached, so dragging within
  // "Available Documents" just makes them easier to browse; it resets on
  // refetch and is never sent to `onChange`.
  const [unattachedOrderOverride, setUnattachedOrderOverride] = React.useState<string[] | null>(null);

  const { attachedRows, unattachedRows: unattachedRowsDefault } = React.useMemo(
    () => buildRows(documents, attached),
    [documents, attached],
  );

  const unattachedRows = React.useMemo(() => {
    if (!unattachedOrderOverride) return unattachedRowsDefault;
    const byPath = new Map(unattachedRowsDefault.map((row) => [row.path, row]));
    const ordered = unattachedOrderOverride
      .map((path) => byPath.get(path))
      .filter((row): row is ContextDocRow => row != null);
    const seen = new Set(ordered.map((row) => row.path));
    return [...ordered, ...unattachedRowsDefault.filter((row) => !seen.has(row.path))];
  }, [unattachedRowsDefault, unattachedOrderOverride]);

  const order = attachedRows.map((row) => row.path);
  const unattachedOrder = unattachedRows.map((row) => row.path);
  const total = totalAttachedTokens(attachedRows);
  const overCap = isOverCap(total, tokenCap);

  const commit = (nextPaths: string[]) => {
    if (disabled) return;
    onChange(nextPaths);
  };
  const attach = (path: string) => commit([...order, path]);
  const detach = (path: string) => commit(order.filter((p) => p !== path));
  const toggle = (row: ContextDocRow) => (row.attached ? detach(row.path) : attach(row.path));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(order, oldIndex, newIndex));
  };

  const unattachedSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onUnattachedDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = unattachedOrder.indexOf(String(active.id));
    const newIndex = unattachedOrder.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    setUnattachedOrderOverride(arrayMove(unattachedOrder, oldIndex, newIndex));
  };

  const previewRow: ContextDocRow | undefined =
    previewPath != null
      ? (attachedRows.find((row) => row.path === previewPath) ?? unattachedRows.find((row) => row.path === previewPath))
      : undefined;

  if (loading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={38} />
        <Skeleton height={38} />
        <Skeleton height={38} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={s.wrap}>
        <div role="alert" style={s.loadError}>
          {t("loadError")}
        </div>
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      {!hideSummary && (
        <>
          <div style={s.summaryBar}>
            <span style={s.summaryTotal}>{t("picker.totalTokens", { tokens: total })}</span>
            {overCap && (
              <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
                {t("picker.overCapLabel")}
              </Badge>
            )}
          </div>
          {overCap && <div style={s.emptyNote}>{t("picker.overCapHint", { cap: tokenCap })}</div>}
        </>
      )}
      {mapReduce && <div style={s.mapReduceNote}>{t("picker.mapReduceNote")}</div>}

      <div>
        <div style={s.sectionLabel}>{t("picker.attachedHeading")}</div>
        {attachedRows.length === 0 ? (
          <div style={s.emptyNote}>{t("picker.noneAttached")}</div>
        ) : (
          <>
            <div style={s.emptyNote}>{t("picker.orderHint")}</div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <div style={s.list}>
                  {attachedRows.map((row) => (
                    <SortableDocRow
                      key={row.path}
                      row={row}
                      disabled={disabled}
                      onToggle={() => toggle(row)}
                      onPreview={() => setPreviewPath(row.path)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>

      <div>
        <div style={s.sectionLabel}>{t("picker.unattachedHeading")}</div>
        {unattachedRows.length === 0 ? (
          <div style={s.emptyNote}>{t("picker.noDocuments")}</div>
        ) : (
          <DndContext sensors={unattachedSensors} collisionDetection={closestCenter} onDragEnd={onUnattachedDragEnd}>
            <SortableContext items={unattachedOrder} strategy={verticalListSortingStrategy}>
              <div style={s.list}>
                {unattachedRows.map((row) => (
                  <SortableDocRow
                    key={row.path}
                    row={row}
                    disabled={disabled}
                    onToggle={() => toggle(row)}
                    onPreview={() => setPreviewPath(row.path)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {previewRow && (
        <PreviewDrawer
          row={previewRow}
          repoId={repoId}
          onToggleAttach={() => toggle(previewRow)}
          onClose={() => setPreviewPath(null)}
        />
      )}
    </div>
  );
}
