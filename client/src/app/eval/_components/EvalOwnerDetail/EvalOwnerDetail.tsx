"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, ErrorState, Skeleton } from "@devdigest/ui";
import type { EvalOwnerKind, EvalRunRecord } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { useAgents } from "../../../../lib/hooks/agents";
import { useSkills } from "../../../../lib/hooks/skills";
import { useEvalDashboard } from "../../../../lib/hooks/eval";
import { resolveOwner } from "../EvalOverview/helpers";
import { OWNER_DELETED_LABEL } from "../EvalOverview/constants";
import { CompareRunsModal } from "../CompareRunsModal";
import { AlertBanner } from "./_components/AlertBanner";
import { MetricCardsRow } from "./_components/MetricCardsRow";
import { TrendChart } from "./_components/TrendChart";
import { RecentRunsTable } from "./_components/RecentRunsTable";
import { useOwnerAgentVersions } from "./useOwnerAgentVersions";
import { BACK_LABEL, LOAD_ERROR_BODY } from "./constants";
import { s } from "./styles";

export interface EvalOwnerDetailProps {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  /** Returns to the overview — the caller (`page.tsx`) owns the actual
   *  selection state this clears; see the T12->T13 wiring note there. */
  onBack: () => void;
}

/**
 * EvalOwnerDetail (T13) — one owner's eval-dashboard detail: the AC-32
 * regression alert banner (when present), a metric card per metric with
 * its delta and sparkline, the metric trend chart, and the recent-runs
 * table with AC-33 compare selection and AC-46 per-run version labels.
 * Rendered by `page.tsx` in place of `EvalOverview` once a row is selected.
 */
export function EvalOwnerDetail({ ownerKind, ownerId, onBack }: EvalOwnerDetailProps) {
  const t = useTranslations("eval");
  const filter = React.useMemo(() => ({ owner_kind: ownerKind, owner_id: ownerId }), [ownerKind, ownerId]);

  const { data: dashboard, isLoading, isError, refetch } = useEvalDashboard(filter);
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  const { data: versions } = useOwnerAgentVersions(ownerKind, ownerId);

  const [selected, setSelected] = React.useState<string[]>([]);
  // T14's wiring point: opens once the user activates "Compare" with
  // exactly two runs selected (AC-33 stays this task's own concern; AC-34,
  // the modal itself, is `CompareRunsModal/**`, T14's owned path — see the
  // T14 plan brief's authorization to wire this open/close state here,
  // the same kind of gap T13 filled for T12's `onSelectOwner`).
  const [compareOpen, setCompareOpen] = React.useState(false);
  const selectedRuns = dashboard?.recent_runs.filter((run) => selected.includes(run.id)) ?? [];

  const toggleRun = (runId: string) =>
    setSelected((prev) => {
      if (prev.includes(runId)) return prev.filter((id) => id !== runId);
      if (prev.length < 2) return [...prev, runId];
      // Drop the oldest selection, keep the newer one, add the new pick —
      // `prev[1]` is always defined here (prev.length is exactly 2), but
      // `noUncheckedIndexedAccess` types it as `string | undefined`.
      const second = prev[1];
      return second !== undefined ? [second, runId] : [runId];
    });

  const owner = resolveOwner(ownerKind, ownerId, agents ?? [], skills ?? []);
  const displayName = owner.orphaned ? OWNER_DELETED_LABEL : (owner.name ?? "");

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbSkillsLab") },
        // No dedicated `/eval/:ownerId` route — this page swaps overview vs.
        // detail via `onBack`'s local state (`page.tsx`), so the crumb goes
        // back through that callback rather than an `href` (a same-URL
        // `<Link>` click wouldn't reset that state — see EvalPage).
        { label: t("page.crumbEvalDashboard"), onClick: onBack },
        { label: displayName },
      ]}
    >
      <div style={s.page}>
        <button type="button" onClick={onBack} style={s.back}>
          <Icon.ChevronLeft size={16} />
          {BACK_LABEL}
        </button>

        <div style={s.header}>
          <h1 style={s.h1}>
            {displayName}
            {owner.model && <span style={s.h1Model}>{owner.model}</span>}
          </h1>
        </div>

        {isLoading && <Skeleton height={64} />}
        {!isLoading && isError && <ErrorState body={LOAD_ERROR_BODY} onRetry={() => refetch()} />}
        {!isLoading && !isError && dashboard && (
          <>
            {dashboard.alert && <AlertBanner alert={dashboard.alert} />}
            <MetricCardsRow dashboard={dashboard} />
            <TrendChart dashboard={dashboard} />
            <RecentRunsTable
              runs={dashboard.recent_runs}
              versions={versions ?? []}
              selected={selected}
              onToggle={toggleRun}
              onCompare={() => setCompareOpen(true)}
            />
          </>
        )}

        {compareOpen && selectedRuns.length === 2 && (
          <CompareRunsModal
            runs={selectedRuns as [EvalRunRecord, EvalRunRecord]}
            versions={versions ?? []}
            onClose={() => setCompareOpen(false)}
          />
        )}
      </div>
    </AppShell>
  );
}
