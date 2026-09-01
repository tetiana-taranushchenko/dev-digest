"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox, EmptyState, ProgressBar, SectionLabel } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { formatRanAt } from "../../EvalOverview/helpers";
import { formatCost, inferVersionLabel, pct, type AgentVersionSnapshot } from "../helpers";
import { COMPARE_LABEL, NO_VERSION_LABEL, SELECT_TWO_HINT, VERSION_COLUMN_LABEL, selectedCountLabel } from "../constants";
import { s } from "../styles";

/** One metric's mini progress bar + percentage, mirrors the design
 *  reference's `MiniBar` (`screen_skills-eval-dashboard-compare-modal.jsx:3-8`)
 *  built on the existing `ProgressBar` primitive instead of a bespoke bar. */
function MiniMetric({ value, color }: { value: number; color: string }) {
  return (
    <div style={s.miniMetric}>
      <div style={s.miniMetricBar}>
        <ProgressBar value={pct(value)} color={color} />
      </div>
      <span className="tnum" style={s.miniMetricValue}>{`${pct(value)}%`}</span>
    </div>
  );
}

/**
 * RecentRunsTable — AC-32's recent-runs table plus AC-33's compare
 * selection (checkbox per row, "Compare" enabled only once exactly two are
 * selected, else the "Select two runs to compare" hint) and AC-46's
 * per-row inferred version label. Selection is local state owned by the
 * parent (`EvalOwnerDetail`) — T14's `CompareRunsModal` opens from it.
 * `onCompare` intentionally has no wiring here beyond receiving the
 * callback: which two run ids to compare against is all AC-33 requires of
 * this task; opening the modal itself is AC-34, T14's owned path.
 */
export function RecentRunsTable({
  runs,
  versions,
  selected,
  onToggle,
  onCompare,
}: {
  runs: EvalRunRecord[];
  versions: AgentVersionSnapshot[];
  selected: string[];
  onToggle: (runId: string) => void;
  onCompare: () => void;
}) {
  const t = useTranslations("eval");
  const canCompare = selected.length === 2; // AC-33

  return (
    <div>
      <div style={s.runsHeaderRow}>
        <SectionLabel icon="History">{t("dashboard.recentRuns")}</SectionLabel>
        <span style={s.runsHint}>{selected.length === 0 ? SELECT_TWO_HINT : selectedCountLabel(selected.length)}</span>
        <div style={s.runsHintPush}>
          <Button kind={canCompare ? "primary" : "ghost"} size="sm" icon="GitBranch" disabled={!canCompare} onClick={onCompare}>
            {COMPARE_LABEL}
          </Button>
        </div>
      </div>

      {runs.length === 0 ? (
        <EmptyState icon="History" title={t("dashboard.noRuns")} />
      ) : (
        <div style={s.table} role="list">
          <div style={{ ...s.tableRow, ...s.tableHeadRow }} role="presentation">
            <span />
            <span>{t("dashboard.table.ranAt")}</span>
            <span>{VERSION_COLUMN_LABEL}</span>
            <span>{t("dashboard.table.recall")}</span>
            <span>{t("dashboard.table.precision")}</span>
            <span>{t("dashboard.table.citation")}</span>
            <span>{t("dashboard.table.pass")}</span>
            <span>{t("dashboard.table.cost")}</span>
          </div>
          {runs.map((run) => {
            const isSelected = selected.includes(run.id);
            const versionLabel = inferVersionLabel(run.ran_at, versions) ?? NO_VERSION_LABEL;
            return (
              <div
                key={run.id}
                role="listitem"
                aria-label={formatRanAt(run.ran_at) ?? run.ran_at}
                onClick={() => onToggle(run.id)}
                style={{
                  ...s.tableRow,
                  ...s.tableBodyRow,
                  ...(isSelected ? s.tableBodyRowSelected : {}),
                }}
              >
                <Checkbox checked={isSelected} />
                <span style={s.ranAtCell}>{formatRanAt(run.ran_at) ?? run.ran_at}</span>
                <span style={s.versionCell}>{versionLabel}</span>
                <MiniMetric value={run.recall ?? 0} color="var(--accent)" />
                <MiniMetric value={run.precision ?? 0} color="var(--ok)" />
                <MiniMetric value={run.citation_accuracy ?? 0} color="var(--warn)" />
                <span style={s.passCell}>{run.pass ? t("dashboard.pass") : t("dashboard.fail")}</span>
                <span style={s.costCell}>{formatCost(run.cost_usd)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
