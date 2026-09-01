"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, LineChart, SectionLabel } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";
import { s } from "../styles";

const LEGEND: { key: "recall" | "precision" | "citation"; color: string }[] = [
  { key: "recall", color: "var(--accent)" },
  { key: "precision", color: "var(--ok)" },
  { key: "citation", color: "var(--warn)" },
];

/**
 * TrendChart — AC-32's "the metric trend chart": one multi-series line
 * chart of Recall/Precision/Citation over every point in
 * `EvalDashboard.trend`, distinct from each `MetricCard`'s own small
 * sparkline (mirrors the design reference's `ScreenEval`,
 * `screen_skills-eval-dashboard-compare-modal.jsx:446-454`).
 */
export function TrendChart({ dashboard }: { dashboard: EvalDashboard }) {
  const t = useTranslations("eval");

  return (
    <Card style={s.trendCard}>
      <div style={s.trendHeader}>
        <SectionLabel icon="TrendingUp">{t("dashboard.metricTrend")}</SectionLabel>
        {/* `data-testid` here is a deliberate exception to the project's
            accessible-query-first testing convention: this legend's item
            labels ("Recall"/"Precision"/"Citation", `dashboard.legend.*`)
            are byte-identical to `RecentRunsTable`'s column headers
            (`dashboard.table.*`) rendered lower on the same page, so no
            accessible-role or text query can disambiguate them — see
            `EvalOwnerDetail.test.tsx`'s "renders a metric card..." test. */}
        <div style={s.legend} data-testid="trend-legend">
          {LEGEND.map(({ key, color }) => (
            <span key={key} style={s.legendItem}>
              <span style={{ ...s.legendSwatch, background: color }} />
              {t(`dashboard.legend.${key}`)}
            </span>
          ))}
        </div>
      </div>
      <LineChart
        series={[
          { name: "recall", color: "var(--accent)", data: dashboard.trend.map((p) => p.recall) },
          { name: "precision", color: "var(--ok)", data: dashboard.trend.map((p) => p.precision) },
          { name: "citation", color: "var(--warn)", data: dashboard.trend.map((p) => p.citation_accuracy) },
        ]}
        w={900}
        h={200}
      />
    </Card>
  );
}
