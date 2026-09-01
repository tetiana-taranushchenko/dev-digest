"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import type { EvalOwnerKind } from "@devdigest/shared";
import { AppShell } from "../../../../components/app-shell";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { useAgents } from "../../../../lib/hooks/agents";
import { useSkills } from "../../../../lib/hooks/skills";
import { useBulkRunStatus, useEvalOverview, useRunAllEvals } from "../../../../lib/hooks/eval";
import { OwnerRow } from "./_components/OwnerRow";
import { resolveOwner, totalRunnableCases } from "./helpers";
import {
  EMPTY_BODY,
  EMPTY_TITLE,
  LOAD_ERROR_BODY,
  OVERVIEW_SUBTITLE,
  RUN_ALL_AGENTS_LABEL,
  RUN_ALL_CONFIRM_TITLE,
  runAllConfirmMessage,
} from "./constants";
import { s } from "./styles";

/**
 * EvalOverview (T12) — the `/eval` route's cross-owner overview: one row per
 * agent/skill with its latest run timestamp, pass count, and
 * Recall/Precision/Citation (AC-31), reachable from the existing SKILLS LAB
 * nav entry (AC-35, verified — not edited — by this task). "Run all agents"
 * asks for confirmation naming the total case/LLM-call count before firing
 * the workspace-wide bulk run (AC-43), excluding orphaned owners' cases from
 * that count (AC-39). `onSelectOwner` (T13's integration point, wired from
 * `page.tsx`) is optional so this stays renderable standalone with no
 * selection behavior.
 */
export function EvalOverview({
  onSelectOwner,
}: {
  onSelectOwner?: (ownerKind: EvalOwnerKind, ownerId: string) => void;
} = {}) {
  const t = useTranslations("eval");
  const { data: overview, isLoading: overviewLoading, isError, refetch } = useEvalOverview();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: skills, isLoading: skillsLoading } = useSkills();

  const [confirming, setConfirming] = React.useState(false);
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const runAll = useRunAllEvals();
  const { data: batch } = useBulkRunStatus(batchId);

  // Self-clears once the batch reaches "done" (same pattern as EvalsTab) —
  // `useBulkRunStatus` stops polling on its own.
  React.useEffect(() => {
    if (batch?.status === "done") setBatchId(null);
  }, [batch?.status]);

  const running = batchId !== null;
  const isLoading = overviewLoading || agentsLoading || skillsLoading;

  const list = overview ?? [];
  const agentList = agents ?? [];
  const skillList = skills ?? [];
  const totalCases = totalRunnableCases(list, agentList, skillList);

  const startRunAll = async () => {
    setConfirming(false);
    const started = await runAll.mutateAsync({}); // workspace-wide — no owner filter (AC-43)
    setBatchId(started.batch_id);
  };

  return (
    <AppShell crumb={[{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }]}>
      {confirming && (
        <ConfirmDialog
          title={RUN_ALL_CONFIRM_TITLE}
          message={runAllConfirmMessage(totalCases)}
          confirmLabel={RUN_ALL_AGENTS_LABEL}
          onCancel={() => setConfirming(false)}
          onConfirm={startRunAll}
        />
      )}
      <div style={s.page}>
        <div style={s.header}>
          <div>
            <h1 style={s.h1}>{t("dashboard.defaultTitle")}</h1>
            <p style={s.subtitle}>{OVERVIEW_SUBTITLE}</p>
          </div>
          <Button
            kind="primary"
            icon="Play"
            onClick={() => setConfirming(true)}
            disabled={running || totalCases === 0}
          >
            {running ? t("dashboard.running") : RUN_ALL_AGENTS_LABEL}
          </Button>
        </div>

        {isLoading && <Skeleton height={64} />}
        {!isLoading && isError && <ErrorState body={LOAD_ERROR_BODY} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState icon="FlaskConical" title={EMPTY_TITLE} body={EMPTY_BODY} />
        )}
        {!isLoading && !isError && list.length > 0 && (
          <div style={s.list} role="list">
            {list.map((dashboard) => (
              <OwnerRow
                key={`${dashboard.owner_kind}:${dashboard.owner_id}`}
                dashboard={dashboard}
                owner={resolveOwner(dashboard.owner_kind, dashboard.owner_id, agentList, skillList)}
                onSelect={
                  dashboard.owner_kind && dashboard.owner_id
                    ? () => onSelectOwner?.(dashboard.owner_kind!, dashboard.owner_id!)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
