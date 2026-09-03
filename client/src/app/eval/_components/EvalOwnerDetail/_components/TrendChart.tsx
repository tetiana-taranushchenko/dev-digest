"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, LineChart, SectionLabel } from "@devdigest/ui";
import type { EvalDashboard } from "@devdigest/shared";
import { s } from "../styles";

/**
 * TrendChart — AC-32's "the metric trend chart": one multi-series line
 * chart of Recall/Precision/Citation over every point in
 * `EvalDashboard.trend`, distinct from each `MetricCard`'s own small
 * sparkline (mirrors the design reference's `ScreenEval`,
 * `screen_skills-eval-dashboard-compare-modal.jsx:446-454`). No legend —
 * each series' color already keys to its own `MetricCard` above.
 */
export function TrendChart({ dashboard }: { dashboard: EvalDashboard }) {
  const t = useTranslations("eval");

  return (
    <Card style={s.trendCard}>
      <div style={s.trendHeader}>
        <SectionLabel icon="TrendingUp">{t("dashboard.metricTrend")}</SectionLabel>
      </div>
      <LineChart
        series={[
          { name: "recall", color: "var(--accent)", data: dashboard.trend.map((p) => p.recall) },
          { name: "precision", color: "var(--ok)", data: dashboard.trend.map((p) => p.precision) },
          { name: "citation", color: "var(--warn)", data: dashboard.trend.map((p) => p.citation_accuracy) },
        ]}
        // `LineChart`'s wrapper uses `w` as a `maxWidth` cap (vendored,
        // do-not-touch) — a large ceiling here just means "fill the card",
        // matching the rest of this page's now-unconstrained width.
        w={4000}
        h={200}
      />
    </Card>
  );
}
