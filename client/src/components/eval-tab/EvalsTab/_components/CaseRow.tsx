"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import { ConfirmDialog } from "../../../ConfirmDialog";
import { caseDisplayName, caseKindOf, caseStateOf, parseExpectedFindings, producedCountOf } from "../helpers";
import { MUST_FIND_LABEL, MUST_NOT_FLAG_LABEL, OWNER_DELETED_LABEL, expectedGotLabel } from "../constants";
import { s } from "../styles";

const STATE_ICON = {
  passing: { icon: Icon.CheckCircle, color: "var(--ok)" },
  failing: { icon: Icon.XCircle, color: "var(--crit)" },
  "never-run": { icon: Icon.Dot, color: "var(--text-muted)" },
} as const;

/**
 * CaseRow — one eval case's name, expected-vs-actual summary (recall of its
 * latest run), and exactly one of passing/failing/never-run (AC-21). Run
 * (AC-22) and Edit both open through the owning `EvalsTab`; an orphaned
 * owner (AC-39) renders "Owner deleted" and disables both controls. Also
 * surfaces the case's kind (`must_find`/`must_not_flag`, derived from
 * `expected_output` — `helpers.ts`'s `caseKindOf`) and, for a `must_find`
 * case whose seed carried one, its source finding's severity/category.
 */
export function CaseRow({
  evalCase,
  latestRun,
  orphan,
  running,
  runDisabled,
  onRun,
  onEdit,
  onDelete,
}: {
  evalCase: EvalCase;
  latestRun: EvalRunRecord | undefined;
  orphan: boolean;
  running: boolean;
  runDisabled: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const state = caseStateOf(latestRun);
  const kind = caseKindOf(evalCase);
  const [firstExpected] = parseExpectedFindings(evalCase);
  const severity = typeof firstExpected?.severity === "string" ? firstExpected.severity : null;
  const category = typeof firstExpected?.category === "string" ? firstExpected.category : null;
  const { icon: StateIcon, color: stateColor } = STATE_ICON[state];

  const stateLabel =
    state === "passing" ? t("evalsTab.passed") : state === "failing" ? t("evalsTab.failed") : t("evalsTab.neverRun");

  const detailSuffix =
    state !== "never-run" && latestRun?.recall != null
      ? ` · ${expectedGotLabel(parseExpectedFindings(evalCase).length, producedCountOf(latestRun) ?? 0)}` +
        t("evalsTab.recallSuffix", { recall: Math.round(latestRun.recall * 100) })
      : "";

  return (
    <div style={s.caseRow} role="listitem" aria-label={evalCase.name} data-state={state}>
      <div style={s.caseLeft}>
        <span style={s.caseStatusIcon} title={stateLabel}>
          <StateIcon size={16} color={stateColor} />
        </span>
        <div style={s.caseInfo}>
          <div style={s.caseNameRow}>
            <span style={s.caseName} title={caseDisplayName(evalCase)}>
              {caseDisplayName(evalCase)}
            </span>
            <span style={s.caseKindBadge}>
              {kind === "must_find" ? (
                <Badge color="var(--accent-text)" bg="var(--accent-bg)">
                  {MUST_FIND_LABEL}
                </Badge>
              ) : (
                <Badge color="var(--ok)" bg="var(--ok-bg)">
                  {MUST_NOT_FLAG_LABEL}
                </Badge>
              )}
            </span>
          </div>
          <span style={s.caseSummary}>
            {orphan && <span style={s.orphanBadge}>{OWNER_DELETED_LABEL}</span>}
            {stateLabel}
            {detailSuffix}
          </span>
        </div>
      </div>
      <div style={s.caseRight}>
        <span style={s.caseTag}>{severity && category ? `${severity} · ${category}` : ""}</span>
        <div style={s.caseActions}>
          <Button
            kind="ghost"
            size="sm"
            icon="Play"
            loading={running}
            onClick={onRun}
            disabled={orphan || runDisabled}
          >
            {running ? t("evalsTab.running") : t("evalsTab.run")}
          </Button>
          <Button kind="ghost" size="sm" icon="Edit" onClick={onEdit} disabled={orphan}>
            {t("evalsTab.edit")}
          </Button>
          <Button
            kind="ghost"
            size="sm"
            icon="Trash"
            onClick={() => setConfirmDelete(true)}
            aria-label={t("evalsTab.delete")}
            title={t("evalsTab.delete")}
          />
        </div>
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title={t("evalsTab.deleteTitle")}
          message={t("evalsTab.deleteConfirm", { name: evalCase.name })}
          confirmLabel={t("evalsTab.delete")}
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
        />
      )}
    </div>
  );
}
