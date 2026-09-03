"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalRun } from "@devdigest/shared";
import { computeRunPassed } from "../helpers";
import { s } from "../styles";

/** RunOnSaveResult — the inline outcome banner shown after "Run on save" (or
 *  "Run case") resolves (AC-26). Renders nothing until a run has happened in
 *  this editor session. */
export function RunOnSaveResult({ result }: { result: EvalRun | null }) {
  const t = useTranslations("eval");
  if (!result) return null;

  const pass = computeRunPassed(result);
  const recall = Math.round(result.recall * 100);
  const precision = Math.round(result.precision * 100);
  const citation = Math.round(result.citation_accuracy * 100);
  const duration = (result.duration_ms / 1000).toFixed(1);

  return (
    <div role="status" style={{ ...s.runResult, ...(pass ? s.runResultPass : s.runResultFail) }}>
      <span style={s.runResultLabel}>{t(pass ? "caseEditor.lastRunPassed" : "caseEditor.lastRunFailed")}</span>
      <span style={s.runResultSummary}>
        {t("caseEditor.resultSummary", { recall, precision, citation, duration })}
      </span>
    </div>
  );
}
