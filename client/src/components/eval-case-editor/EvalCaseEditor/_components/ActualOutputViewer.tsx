"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalRun } from "@devdigest/shared";
import { s } from "../styles";

/**
 * ActualOutputViewer — read-only counterpart to ExpectedOutputEditor. Shows
 * what the last run actually matched for each `expected_output` entry
 * (`per_trace[].actual`, the same finding shape `expected_output` uses; `null`
 * per_trace entries — an expected finding the run missed — are omitted, not
 * shown as `null`). Renders a placeholder until a run has happened in this
 * editor session.
 *
 * Builds its own label (mirroring `FormField`'s, not reusing it) because its
 * box must be `flex: 1` to absorb whatever height `ExpectedOutputEditor`'s
 * fixed-rows textarea leaves in the right column — `FormField` doesn't expose
 * a `style` hook, so it can't participate in that flex sizing. The right
 * column is stretched by `EvalCaseEditor.tsx`'s `s.columns` grid to match the
 * Input column's height, whichever Input tab (Diff/Files/PR meta) is active —
 * that's how this box ends level with Input's bottom instead of a hardcoded
 * pixel guess that only happened to fit one tab.
 */
export function ActualOutputViewer({ result }: { result: EvalRun | null }) {
  const t = useTranslations("eval");
  const actual = result ? result.per_trace.map((trace) => trace.actual).filter((a) => a != null) : null;

  return (
    <div style={s.actualOutputField}>
      <div style={s.actualOutputLabel}>{t("caseEditor.actualOutput")}</div>
      <pre
        className={actual ? "mono" : undefined}
        style={{ ...s.actualOutput, ...(actual ? s.actualOutputFilled : s.actualOutputEmpty) }}
      >
        {actual ? JSON.stringify(actual, null, 2) : t("caseEditor.neverRunYet")}
      </pre>
    </div>
  );
}
