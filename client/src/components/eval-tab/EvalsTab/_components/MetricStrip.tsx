"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";
import { TRACES_PASSED_LABEL } from "../constants";
import { s } from "../styles";

function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

function deltaPct(fraction: number): number {
  return Math.round(fraction * 100 * 100) / 100;
}

/**
 * MetricStrip — Recall / Precision / Citation accuracy / Traces passed for
 * the current owner, each with its delta where one exists (AC-20). A delta
 * only exists once the dashboard has at least two trend points
 * (`EvalDashboard.trend`, `server/src/modules/eval/dashboard.ts:190-197`) —
 * `Traces passed` never has one (`EvalDashboard.delta` has no
 * `traces_passed` field).
 */
export function MetricStrip({ dashboard }: { dashboard: EvalDashboard }) {
  const t = useTranslations("eval");
  const hasDelta = dashboard.trend.length >= 2;

  return (
    <div style={s.metricsRow}>
      <MetricCard
        label={t("dashboard.metrics.recall")}
        value={pct(dashboard.current.recall)}
        suffix="%"
        delta={hasDelta ? deltaPct(dashboard.delta.recall) : undefined}
      />
      <MetricCard
        label={t("dashboard.metrics.precision")}
        value={pct(dashboard.current.precision)}
        suffix="%"
        delta={hasDelta ? deltaPct(dashboard.delta.precision) : undefined}
      />
      <MetricCard
        label={t("dashboard.metrics.citationAccuracy")}
        value={pct(dashboard.current.citation_accuracy)}
        suffix="%"
        delta={hasDelta ? deltaPct(dashboard.delta.citation_accuracy) : undefined}
      />
      <MetricCard
        label={TRACES_PASSED_LABEL}
        value={`${dashboard.current.traces_passed}/${dashboard.current.traces_total}`}
      />
    </div>
  );
}
