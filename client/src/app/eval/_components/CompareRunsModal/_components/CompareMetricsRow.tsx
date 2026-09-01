"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { formatCost, pct } from "../helpers";
import { METRIC_LABELS } from "../constants";
import { s } from "../styles";

/** One metric's old -> new comparison card, mirrors the design reference's
 *  `CompareMetric` (`screen_skills-eval-dashboard-compare-modal.jsx:303-314`). */
function MetricCompareCard({
  label,
  oldValue,
  newValue,
  color,
  isPercent,
}: {
  label: string;
  oldValue: number | null;
  newValue: number | null;
  color: string;
  isPercent: boolean;
}) {
  const delta = oldValue != null && newValue != null ? newValue - oldValue : null;
  const format = (v: number | null) => (isPercent ? (v == null ? "—" : `${pct(v)}%`) : formatCost(v));

  return (
    <div style={s.metricCard}>
      <div style={s.metricLabel}>{label}</div>
      <div style={s.metricValues}>
        <span className="tnum" style={s.metricOld}>
          {format(oldValue)}
        </span>
        <Icon.ArrowRight size={13} style={{ color: "var(--text-muted)" }} />
        <span className="tnum" style={{ ...s.metricNew, color }}>
          {format(newValue)}
        </span>
        {delta != null && Math.abs(delta) > 0.0001 && (
          <span className="tnum" style={{ ...s.metricDelta, color: delta >= 0 ? "var(--ok)" : "var(--crit)" }}>
            {delta >= 0 ? "▲ " : "▼ "}
            {isPercent ? `${Math.abs(Math.round(delta * 100))}pt` : Math.abs(delta).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * CompareMetricsRow — AC-34's per-metric old -> new deltas: Recall,
 * Precision, Citation (all percent-formatted) and Cost (dollar-formatted).
 * `older`/`newer` are already chronologically ordered by the caller
 * (`helpers.ts`'s `orderRuns`).
 */
export function CompareMetricsRow({ older, newer }: { older: EvalRunRecord; newer: EvalRunRecord }) {
  return (
    <div style={s.metricsRow}>
      <MetricCompareCard
        label={METRIC_LABELS.recall}
        oldValue={older.recall}
        newValue={newer.recall}
        color="var(--accent)"
        isPercent
      />
      <MetricCompareCard
        label={METRIC_LABELS.precision}
        oldValue={older.precision}
        newValue={newer.precision}
        color="var(--ok)"
        isPercent
      />
      <MetricCompareCard
        label={METRIC_LABELS.citation}
        oldValue={older.citation_accuracy}
        newValue={newer.citation_accuracy}
        color="var(--warn)"
        isPercent
      />
      <MetricCompareCard
        label={METRIC_LABELS.cost}
        oldValue={older.cost_usd}
        newValue={newer.cost_usd}
        color="var(--text-primary)"
        isPercent={false}
      />
    </div>
  );
}
