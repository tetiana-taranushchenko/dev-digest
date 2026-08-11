/* AgentCard — model chip, skills count, enabled toggle. Stats are an A5 mount;
   we render the provider/model + skill count here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useDeleteAgent } from "../../../../lib/hooks/agents";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { modelColor } from "./helpers";
import { s } from "./styles";

export function AgentCard({
  ag,
  active,
  skillCount,
  showDelete = true,
  onClick,
  onToggle,
}: {
  ag: Agent;
  active?: boolean;
  skillCount?: number;
  /** Hide the delete button — used for the compact sidebar list inside the
   *  Agent Editor page; the main `/agents` grid keeps it (default true). */
  showDelete?: boolean;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("agents");
  const del = useDeleteAgent();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const color = modelColor(ag.model);

  return (
    <div onClick={onClick} style={s.card(!!active, ag.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Cpu size={15} />
        </div>
        <span style={s.name}>{ag.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={ag.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>
      {confirmDelete && (
        <div onClick={(e) => e.stopPropagation()}>
          <ConfirmDialog
            title={t("card.deleteTitle")}
            message={t("card.deleteConfirm", { name: ag.name })}
            confirmLabel={t("card.delete")}
            danger
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() => {
              del.mutate(ag.id);
              setConfirmDelete(false);
            }}
          />
        </div>
      )}
      <div style={s.description}>{ag.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <span className="mono" style={s.modelChip(color)}>
          {ag.model}
        </span>
        {skillCount != null && (
          <Badge color="var(--text-secondary)" icon="Sparkles">
            {t("card.skillCount", { count: skillCount })}
          </Badge>
        )}
        {showDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(true);
            }}
            disabled={del.isPending}
            title={t("card.delete")}
            aria-label={t("card.delete")}
            style={{
              marginLeft: "auto",
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
        )}
      </div>
    </div>
  );
}
