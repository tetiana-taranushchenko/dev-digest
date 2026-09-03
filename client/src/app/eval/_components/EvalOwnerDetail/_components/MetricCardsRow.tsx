"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { MetricCard } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";
import { deltaPct, pct } from "../helpers";
import { s } from "../styles";

/**
 * MetricCardsRow — AC-32's "a metric card per metric with its delta and
 * sparkline": Recall / Precision / Citation accuracy, each showing the
 * current value, its delta since the previous trend point (once one
 * exists — `EvalDashboard.delta`), and a sparkline built from the full
 * `EvalDashboard.trend` history (mirrors the design reference's
 * `ScreenEval`, `screen_skills-eval-dashboard-compare-modal.jsx:440-444`).
 */
export function MetricCardsRow({ dashboard }: { dashboard: EvalDashboard }) {
  const t = useTranslations("eval");
  const hasDelta = dashboard.trend.length >= 2;
  const trendOf = (key: "recall" | "precision" | "citation_accuracy") => dashboard.trend.map((p) => p[key]);

  return (
    <div style={s.metricsRow}>
      <MetricCard
        label={t("dashboard.metrics.recall")}
        value={pct(dashboard.current.recall)}
        suffix="%"
        color="var(--accent)"
        trend={trendOf("recall")}
        delta={hasDelta ? deltaPct(dashboard.delta.recall) : undefined}
      />
      <MetricCard
        label={t("dashboard.metrics.precision")}
        value={pct(dashboard.current.precision)}
        suffix="%"
        color="var(--ok)"
        trend={trendOf("precision")}
        delta={hasDelta ? deltaPct(dashboard.delta.precision) : undefined}
      />
      <MetricCard
        label={t("dashboard.metrics.citationAccuracy")}
        value={pct(dashboard.current.citation_accuracy)}
        suffix="%"
        color="var(--warn)"
        trend={trendOf("citation_accuracy")}
        delta={hasDelta ? deltaPct(dashboard.delta.citation_accuracy) : undefined}
      />
    </div>
  );
}
