"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Sparkline } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";
import { formatRanAt, type ResolvedOwner } from "../helpers";
import { NEVER_RUN_LABEL, OWNER_DELETED_LABEL, passCountLabel } from "../constants";
import { s } from "../styles";

function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * OwnerRow — one overview row: owner identity (name/kind/model, or the
 * AC-39 "Owner deleted" fallback), its latest run timestamp + pass count,
 * a recall-trend sparkline, and Recall/Precision/Citation accuracy (AC-31).
 * `onSelect` (T13's integration point) opens the owner's detail view
 * (AC-32) when selecting one is possible — undefined for a scoped, non-
 * overview dashboard read whose `owner_kind`/`owner_id` are null (see
 * `helpers.ts#resolveOwner`'s own defensive-orphan note), which never
 * actually occurs in the overview array but the shared type still allows.
 */
export function OwnerRow({
  dashboard,
  owner,
  onSelect,
}: {
  dashboard: EvalDashboard;
  owner: ResolvedOwner;
  onSelect?: () => void;
}) {
  const t = useTranslations("eval");
  const OwnerIcon = dashboard.owner_kind === "agent" ? Icon.Cpu : Icon.Sparkles;
  const kindLabel =
    dashboard.owner_kind === "agent" ? t("caseEditor.owner.kindAgent") : t("caseEditor.owner.kindSkill");
  const lastRun = formatRanAt(dashboard.recent_runs[0]?.ran_at);
  const trend = dashboard.trend.map((point) => point.recall);
  const displayName = owner.orphaned ? OWNER_DELETED_LABEL : (owner.name ?? "");

  const interactive = !!onSelect;
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!onSelect) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      style={interactive ? { ...s.row, cursor: "pointer" } : s.row}
      role="listitem"
      aria-label={displayName}
      tabIndex={interactive ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
    >
      <div style={s.identity}>
        <div style={s.iconBox}>
          <OwnerIcon size={15} />
        </div>
        <div style={s.identityText}>
          <span style={s.name}>{displayName}</span>
          <span style={s.meta}>
            {kindLabel}
            {owner.model ? ` · ${owner.model}` : ""}
            {" · "}
            {lastRun ?? NEVER_RUN_LABEL}
            {" · "}
            {passCountLabel(dashboard.current.traces_passed, dashboard.current.traces_total)}
          </span>
        </div>
      </div>

      {trend.length > 1 && <Sparkline data={trend} w={64} h={22} />}

      <div style={s.metrics}>
        <div style={s.metric}>
          <span style={s.metricLabel}>{t("dashboard.metrics.recall")}</span>
          <span style={s.metricValue}>{`${pct(dashboard.current.recall)}%`}</span>
        </div>
        <div style={s.metric}>
          <span style={s.metricLabel}>{t("dashboard.metrics.precision")}</span>
          <span style={s.metricValue}>{`${pct(dashboard.current.precision)}%`}</span>
        </div>
        <div style={s.metric}>
          <span style={s.metricLabel}>{t("dashboard.metrics.citationAccuracy")}</span>
          <span style={s.metricValue}>{`${pct(dashboard.current.citation_accuracy)}%`}</span>
        </div>
      </div>
    </div>
  );
}
