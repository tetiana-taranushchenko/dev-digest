/* SkillCard — icon, name, enabled toggle, description, type + source badges.
   The Toggle persists via useUpdateSkill(). Disabled skills from an unvetted
   source (community / imported_url) show a "needs vetting" badge instead of
   letting the Toggle enable them directly — clicking it routes into the
   detail view where the real vetting flow lands in a later phase. The
   optional `stats` line only renders when a `stats` prop is passed in. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill, useDeleteSkill } from "../../../../lib/hooks/skills";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { skillTypeColor, sourceIcon, needsVetting } from "./helpers";
import { s } from "./styles";

export interface SkillCardStats {
  agents: number;
  pullPct: number;
  acceptPct: number;
}

export function SkillCard({
  skill,
  active,
  stats,
  onClick,
}: {
  skill: Skill;
  active?: boolean;
  stats?: SkillCardStats;
  onClick?: () => void;
}) {
  const t = useTranslations("skills");
  const update = useUpdateSkill();
  const del = useDeleteSkill();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const vetting = needsVetting(skill);
  const typeColor = skillTypeColor(skill.type);

  const handleToggle = (enabled: boolean) => {
    if (vetting) {
      // Unvetted + disabled: don't flip it live — send the user into the
      // detail view where the real vetting flow lives.
      onClick?.();
      return;
    }
    update.mutate({ id: skill.id, patch: { enabled } });
  };

  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle on={skill.enabled} onChange={handleToggle} size={14} />
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(true);
          }}
          disabled={del.isPending}
          title={t("card.delete")}
          aria-label={t("card.delete")}
          style={{
            background: "none",
            border: "none",
            cursor: del.isPending ? "not-allowed" : "pointer",
            color: "var(--text-muted)",
            display: "inline-flex",
            padding: 4,
          }}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
      </div>
      {confirmDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title={t("card.deleteTitle")}
            message={t("card.deleteConfirm", { name: skill.name })}
            confirmLabel={t("card.delete")}
            danger
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => {
              del.mutate(skill.id);
              setConfirmDelete(false);
            }}
          />
        </div>
      )}
      <div style={s.description}>{skill.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <Badge color={typeColor} bg={typeColor + "1a"}>
          {t(`listItem.type.${skill.type}`)}
        </Badge>
        <Badge color="var(--text-secondary)" icon={sourceIcon(skill.source)}>
          {t(`listItem.source.${skill.source}`)}
        </Badge>
        {vetting && (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        )}
      </div>
      {stats && (
        <div style={s.statsLine}>
          {t("card.stats", { agents: stats.agents, pull: stats.pullPct, accept: stats.acceptPct })}
        </div>
      )}
    </div>
  );
}
