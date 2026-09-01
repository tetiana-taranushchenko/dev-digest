"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, PercentProgress, Skeleton } from "@devdigest/ui";
import type { Agent, EvalCaseInput, EvalOwnerKind, Skill } from "@devdigest/shared";
import { useBulkRunStatus, useEvalCases, useEvalDashboard, useRunAllEvals, useRunEvalCase } from "../../../lib/hooks/eval";
import { EvalCaseEditor } from "../../eval-case-editor/EvalCaseEditor";
import { MetricStrip } from "./_components/MetricStrip";
import { CaseRow } from "./_components/CaseRow";
import { computePassCounts, isOrphanOwner, latestRunForCase, newCaseSeed } from "./helpers";
import { LINK_AGENT_HINT, OWNER_DELETED_LABEL, RUN_ALL_LABEL, passCountLabel } from "./constants";
import { s } from "./styles";

export interface EvalsTabProps {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  ownerName: string;
  /** Every agent/skill in the workspace — used to detect an orphaned owner
   *  client-side (AC-39), per the plan's "no new endpoint" note. */
  agents: Agent[];
  skills: Skill[];
  /** AC-42 — false only for a skill's Evals tab when the skill has no
   *  currently-enabled linked agent to run its cases through (computed by
   *  the caller, `AgentEditor`/`SkillEditor`); always true for an agent
   *  owner, which never has this dependency. */
  canRun?: boolean;
}

type EditingState = { caseId?: string; seed?: EvalCaseInput } | null;

/**
 * EvalsTab (T11) — the shared Evals tab body for both the Agent Editor and
 * the Skill Editor. Renders the owner's metric strip (AC-20), its eval-case
 * list with each case in exactly one of passing/failing/never-run (AC-21),
 * a single-case run control that only refreshes its own row + the strip
 * (AC-22), "Run all evals" that refreshes every case + the strip on
 * completion (AC-23), both gated off while any run is in flight for this
 * owner (AC-15), "N / M passing" (AC-45), read-only orphaned-owner handling
 * (AC-39), the AC-42 no-enabled-linked-agent hint for skills, and opens T9's
 * `EvalCaseEditor` for "New eval case" / a case's edit control (AC-24).
 */
export function EvalsTab({ ownerKind, ownerId, ownerName, agents, skills, canRun = true }: EvalsTabProps) {
  const t = useTranslations("eval");
  const filter = React.useMemo(() => ({ owner_kind: ownerKind, owner_id: ownerId }), [ownerKind, ownerId]);

  const { data: cases, isLoading: casesLoading } = useEvalCases(filter);
  const { data: dashboard } = useEvalDashboard(filter);

  const [editing, setEditing] = React.useState<EditingState>(null);
  const [runningCaseId, setRunningCaseId] = React.useState<string | null>(null);
  const [batchId, setBatchId] = React.useState<string | null>(null);

  const runCase = useRunEvalCase();
  const runAll = useRunAllEvals();
  const { data: batch } = useBulkRunStatus(batchId);

  // Self-clears once the batch reaches "done" — `useBulkRunStatus` stops
  // polling on its own (`refetchInterval`), this just drops the batch id so
  // the progress UI/disabled state clear too.
  React.useEffect(() => {
    if (batch?.status === "done") setBatchId(null);
  }, [batch?.status]);

  const bulkRunning = batchId !== null;
  const runInFlight = runningCaseId !== null || bulkRunning; // AC-15

  const ownerOrphaned = isOrphanOwner(ownerKind, ownerId, agents, skills); // AC-39
  const casesList = cases ?? [];
  const recentRuns = dashboard?.recent_runs ?? [];
  const counts = computePassCounts(casesList, recentRuns); // AC-45

  const runOne = async (caseId: string) => {
    setRunningCaseId(caseId);
    try {
      await runCase.mutateAsync(caseId); // AC-22 — invalidates only this case + the dashboard
    } finally {
      setRunningCaseId(null);
    }
  };

  const runAllCases = async () => {
    const started = await runAll.mutateAsync({ owner_kind: ownerKind, owner_id: ownerId });
    setBatchId(started.batch_id); // AC-23 — polled via useBulkRunStatus until done
  };

  const runsDisabled = !canRun || ownerOrphaned || runInFlight;

  return (
    <div style={s.wrap} aria-label={`${ownerName} evals`}>
      {dashboard && <MetricStrip dashboard={dashboard} />}

      {!canRun && (
        <div role="status" style={s.hint}>
          {LINK_AGENT_HINT}
        </div>
      )}
      {ownerOrphaned && (
        <div role="status" style={s.hint}>
          {OWNER_DELETED_LABEL}
        </div>
      )}

      <div style={s.header}>
        <div style={s.headingCol}>
          <h3 style={s.heading}>{t("evalsTab.casesHeading")}</h3>
          <span style={s.passCount}>{passCountLabel(counts.passing, counts.total)}</span>
        </div>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            icon="RefreshCw"
            onClick={runAllCases}
            disabled={runsDisabled || casesList.length === 0}
          >
            {bulkRunning ? t("evalsTab.running") : RUN_ALL_LABEL}
          </Button>
          <Button kind="primary" icon="Plus" onClick={() => setEditing({ seed: newCaseSeed(ownerKind, ownerId) })}>
            {t("evalsTab.newCase")}
          </Button>
        </div>
      </div>

      {bulkRunning && batch && (
        <div style={s.progressWrap}>
          <PercentProgress
            value={batch.total > 0 ? (batch.completed / batch.total) * 100 : 0}
            label={`${batch.completed}/${batch.total}`}
          />
        </div>
      )}

      {casesLoading ? (
        <Skeleton height={80} />
      ) : casesList.length === 0 ? (
        <EmptyState icon="FlaskConical" title={t("evalsTab.emptyCases")} />
      ) : (
        <div style={s.list} role="list">
          {casesList.map((evalCase) => (
            <CaseRow
              key={evalCase.id}
              evalCase={evalCase}
              latestRun={latestRunForCase(evalCase.id, recentRuns)}
              orphan={ownerOrphaned}
              running={runningCaseId === evalCase.id}
              runDisabled={runsDisabled}
              onRun={() => runOne(evalCase.id)}
              onEdit={() => setEditing({ caseId: evalCase.id })}
            />
          ))}
        </div>
      )}

      {editing && <EvalCaseEditor seed={editing.seed} caseId={editing.caseId} onClose={() => setEditing(null)} />}
    </div>
  );
}
