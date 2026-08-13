"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MetricCard, CircularScore, Donut, Skeleton, ErrorState, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillStats } from "../../../../../../../lib/hooks/skills";
import { s } from "./styles";

/**
 * Categorical colors for `FindingCategory` ('bug' | 'security' | 'perf' |
 * 'style' | 'test' — server/src/vendor/shared/contracts/findings.ts), taken
 * from the dataviz skill's validated 8-slot categorical order (dark-surface
 * steps, since this app defaults to the dark theme). Fixed order, never
 * cycled by which categories happen to appear in a given skill's data — a
 * category keeps its color whether it has one finding or a hundred. Any
 * category outside this fixed set falls back to the muted text token so it
 * never silently reuses another category's color.
 */
const CATEGORY_COLOR: Record<string, string> = {
  bug: "#3987e5", // slot 1 — blue
  security: "#d95926", // slot 2 — orange
  perf: "#199e70", // slot 3 — aqua
  style: "#c98500", // slot 4 — yellow
  test: "#d55181", // slot 5 — magenta
};
const FALLBACK_COLOR = "var(--text-muted)";

/**
 * Stats tab for the (not-yet-built) Skill Editor. Created ahead of the
 * editor shell per the Phase 7 task so it's ready to be dropped into
 * `SkillEditor`'s tab body once that lands — mirrors the `skill: Skill`
 * prop pattern the Agent Editor's tabs already use (see
 * AgentEditor/_components/SkillsTab, which takes `agent: Agent`).
 */
export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: stats, isLoading, isError, refetch } = useSkillStats(skill.id);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={18} width={320} />
        <div style={s.metricsRow}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
        <Skeleton height={160} />
      </div>
    );
  }

  if (isError || !stats) {
    return <ErrorState title={t("stats.loadError")} onRetry={() => refetch()} />;
  }

  const pullFrequencyPct = stats.pull_frequency == null ? null : Math.round(stats.pull_frequency * 100);
  const acceptRatePct = stats.accept_rate == null ? null : Math.round(stats.accept_rate * 100);

  const categorySegments = Object.keys(stats.findings_by_category)
    .sort((a, b) => a.localeCompare(b))
    .map((category) => ({
      label: category,
      value: stats.estimated_cost_by_category[category] ?? 0,
      color: CATEGORY_COLOR[category] ?? FALLBACK_COLOR,
    }));

  return (
    <div style={s.wrap}>
      {/* Framing — settled product decision: stats describe agents that have
          this skill attached, never findings attributed TO the skill. */}
      <div style={s.framingNote}>{t("stats.framingNote")}</div>

      <div style={s.metricsRow}>
        <MetricCard label={t("stats.usedBy")} value={stats.agent_count} />
        <MetricCard
          label={t("stats.pullFrequency")}
          value={pullFrequencyPct == null ? "—" : pullFrequencyPct}
          suffix={pullFrequencyPct == null ? undefined : "%"}
        />
        <div
          style={s.acceptCard}
          title={t("stats.acceptRateSub", { accepted: stats.accepted, dismissed: stats.dismissed })}
        >
          <div style={s.acceptCardHeader}>
            <span style={s.acceptCardLabel}>{t("stats.acceptRate")}</span>
            {acceptRatePct != null && <CircularScore score={acceptRatePct} size={28} stroke={3} />}
          </div>
          <div style={s.acceptCardValue}>
            {acceptRatePct == null ? "—" : (
              <>
                {acceptRatePct}
                <span style={s.acceptCardSuffix}>%</span>
              </>
            )}
          </div>
        </div>
        <MetricCard label={t("stats.findings30d")} value={stats.findings_30d} />
      </div>

      <div style={s.sectionsRow}>
        <div style={s.section}>
          <div style={s.sectionHeader}>
            <Icon.Cpu size={13} style={s.sectionIcon} />
            <span style={s.sectionLabel}>{t("stats.agentsUsing")}</span>
          </div>
          {stats.agents.length === 0 ? (
            <div style={s.emptyNote}>{t("stats.noAgents")}</div>
          ) : (
            <div style={s.agentList}>
              {stats.agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}?tab=skills`}
                  style={s.agentRow}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={s.agentIconBox}>
                    <Icon.Cpu size={13} />
                  </div>
                  <span style={s.agentName}>{agent.name}</span>
                  <span style={s.agentOpen}>{t("stats.open")}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div style={s.section}>
          <div style={s.sectionHeader}>
            <Icon.Tag size={13} style={s.sectionIcon} />
            <span style={s.sectionLabel}>{t("stats.findingsByCategory")}</span>
          </div>
          {categorySegments.length === 0 ? (
            <div style={s.emptyNote}>{t("stats.noFindings")}</div>
          ) : (
            <div style={s.donutCard}>
              <Donut segments={categorySegments} />
              <div style={s.costDisclaimer}>{t("stats.costDisclaimer")}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
