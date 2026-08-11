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
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { Checkbox, TextInput, Icon, Badge } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import { useAgentSkills, useSetAgentSkills } from "../../../../../../../lib/hooks/agents";
import { useToast } from "../../../../../../../lib/toast";
import { ApiError } from "../../../../../../../lib/api";
import { s } from "./styles";

/** Skills tab — check to link/unlink a skill, drag linked skills to reorder.
    Any check/uncheck/drop fires one POST /agents/:id/skills with the full
    ordered set of linked skill ids. */
export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const toast = useToast();
  const { data: skills } = useSkills();
  const { data: links } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();

  const [filter, setFilter] = React.useState("");
  const [order, setOrder] = React.useState<string[]>([]);

  // Local order mirrors the server's linked set; resync when switching agents
  // or once the links query (re)resolves — mirrors ConfigTab's agent.id reset.
  React.useEffect(() => {
    if (!links) return;
    setOrder([...links].sort((a, b) => a.order - b.order).map((l) => l.skill_id));
  }, [agent.id, links]);

  const skillsById = React.useMemo(() => {
    const m = new Map<string, Skill>();
    for (const sk of skills ?? []) m.set(sk.id, sk);
    return m;
  }, [skills]);

  const linkedSkills = order.map((id) => skillsById.get(id)).filter((sk): sk is Skill => !!sk);
  const unlinkedSkills = React.useMemo(
    () =>
      (skills ?? [])
        .filter((sk) => !order.includes(sk.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [skills, order],
  );

  const norm = filter.trim().toLowerCase();
  const visibleLinked = norm ? linkedSkills.filter((sk) => sk.name.toLowerCase().includes(norm)) : linkedSkills;
  const visibleUnlinked = norm
    ? unlinkedSkills.filter((sk) => sk.name.toLowerCase().includes(norm))
    : unlinkedSkills;

  // The server re-scans every linked skill's body for injection/self-declared-
  // danger content on every set (see AgentsService.assertSkillsSafe) and 422s
  // the whole request if any is risky — revert the optimistic local order and
  // surface why, rather than leaving the UI showing a link that didn't happen.
  const commit = (next: string[]) => {
    const prev = order;
    setOrder(next);
    setSkills.mutate(
      { agentId: agent.id, skillIds: next },
      {
        onError: (err) => {
          setOrder(prev);
          toast.error(err instanceof ApiError ? err.message : t("skills.attachBlocked"));
        },
      },
    );
  };

  const link = (id: string) => commit([...order, id]);
  const unlink = (id: string) => commit(order.filter((x) => x !== id));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    commit(arrayMove(order, oldIndex, newIndex));
  };

  const total = skills?.length ?? 0;
  const linkedCount = order.length;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <span style={s.count}>{t("skills.enabledCount", { linked: linkedCount, total })}</span>
      </div>
      <TextInput value={filter} onChange={setFilter} placeholder={t("skills.filterPlaceholder")} />
      <div style={s.hint}>{t("skills.orderHint")}</div>

      {visibleLinked.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visibleLinked.map((sk) => sk.id)} strategy={verticalListSortingStrategy}>
            <div style={s.list}>
              {visibleLinked.map((sk) => (
                <SortableSkillRow key={sk.id} skill={sk} onUncheck={() => unlink(sk.id)} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {visibleUnlinked.length > 0 && (
        <div style={{ ...s.list, marginTop: visibleLinked.length > 0 ? 14 : 0 }}>
          {visibleUnlinked.map((sk) =>
            sk.injection_flagged ? (
              <div key={sk.id} style={s.rowFlagged} title={sk.injection_reason ?? undefined}>
                <span style={s.handleSpacer} />
                <div style={{ pointerEvents: "none", opacity: 0.5 }}>
                  <Checkbox checked={false} onChange={() => {}} />
                </div>
                <span style={s.name}>{sk.name}</span>
                <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertOctagon">
                  {ts("listItem.injectionDetected")}
                </Badge>
              </div>
            ) : (
              <div key={sk.id} style={s.row}>
                <span style={s.handleSpacer} />
                <Checkbox checked={false} onChange={() => link(sk.id)} />
                <span style={s.name}>{sk.name}</span>
                <Badge>{sk.type}</Badge>
              </div>
            ),
          )}
        </div>
      )}

      {visibleLinked.length === 0 && visibleUnlinked.length === 0 && (
        <div style={s.emptyNote}>{t("skills.filterEmpty")}</div>
      )}
    </div>
  );
}

function SortableSkillRow({ skill, onUncheck }: { skill: Skill; onUncheck: () => void }) {
  const ts = useTranslations("skills");
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: skill.id });
  const flagged = skill.injection_flagged;
  const style: React.CSSProperties = {
    ...(flagged ? s.rowFlagged : s.row),
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition: transition ?? undefined,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} title={flagged ? (skill.injection_reason ?? undefined) : undefined}>
      <button type="button" aria-label="Drag to reorder" style={s.handle} {...attributes} {...listeners}>
        <Icon.Menu size={14} />
      </button>
      {/* Removal (unlink) stays allowed even while flagged — that's the safe
          direction; only newly LINKING a flagged skill is blocked (see the
          unlinked-section row below). */}
      <Checkbox checked onChange={onUncheck} />
      <span style={s.name}>{skill.name}</span>
      {flagged ? (
        <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertOctagon">
          {ts("listItem.injectionDetected")}
        </Badge>
      ) : (
        <Badge>{skill.type}</Badge>
      )}
    </div>
  );
}
