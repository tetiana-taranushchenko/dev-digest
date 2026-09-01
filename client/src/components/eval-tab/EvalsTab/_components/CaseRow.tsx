"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import { caseStateOf } from "../helpers";
import { OWNER_DELETED_LABEL } from "../constants";
import { s } from "../styles";

/**
 * CaseRow — one eval case's name, expected-vs-actual summary (recall of its
 * latest run), and exactly one of passing/failing/never-run (AC-21). Run
 * (AC-22) and Edit both open through the owning `EvalsTab`; an orphaned
 * owner (AC-39) renders "Owner deleted" and disables both controls.
 */
export function CaseRow({
  evalCase,
  latestRun,
  orphan,
  running,
  runDisabled,
  onRun,
  onEdit,
}: {
  evalCase: EvalCase;
  latestRun: EvalRunRecord | undefined;
  orphan: boolean;
  running: boolean;
  runDisabled: boolean;
  onRun: () => void;
  onEdit: () => void;
}) {
  const t = useTranslations("eval");
  const state = caseStateOf(latestRun);

  const stateLabel =
    state === "passing" ? t("evalsTab.passed") : state === "failing" ? t("evalsTab.failed") : t("evalsTab.neverRun");

  const recallSuffix =
    state !== "never-run" && latestRun?.recall != null
      ? t("evalsTab.recallSuffix", { recall: Math.round(latestRun.recall * 100) })
      : "";

  return (
    <div style={s.caseRow} role="listitem" aria-label={evalCase.name} data-state={state}>
      <div style={s.caseInfo}>
        <span style={s.caseName}>{evalCase.name}</span>
        <span style={s.caseSummary}>
          {orphan && <span style={s.orphanBadge}>{OWNER_DELETED_LABEL}</span>}
          {stateLabel}
          {recallSuffix}
        </span>
      </div>
      <div style={s.caseActions}>
        <Button kind="ghost" size="sm" icon="Play" onClick={onRun} disabled={orphan || runDisabled}>
          {running ? t("evalsTab.running") : t("evalsTab.run")}
        </Button>
        <Button kind="ghost" size="sm" icon="Edit" onClick={onEdit} disabled={orphan}>
          {t("evalsTab.edit")}
        </Button>
      </div>
    </div>
  );
}
