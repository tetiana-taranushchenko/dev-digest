/* BriefSummaryPanel — the "what/why/risk_level" section of the PR Brief,
   merged with the PR's latest review verdict/findings/score (`state.verdict`)
   into one Overview-tab card by explicit product direction (2026-08-29) —
   see `BriefVerdictInfo`'s doc comment in types.ts for why this deliberately
   reverses the spec's original D12 ("own visual identity, distinct from the
   verdict banner"). The verdict row reuses `VerdictBanner`'s own icon/color
   mapping (`VERDICT_META`) and its i18n strings (`prReview` namespace) so
   this reads identically to the Findings-tab rendering of the same data.
   Presentational: takes the shared `state` prop from `useBriefSections`
   (owned by OverviewTab, T10) — never calls the hook itself. */
"use client";

import { Badge, Button, CircularScore, EmptyState, ErrorState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import { useTranslations } from "next-intl";
import { VERDICT_META } from "../VerdictBanner/constants";
import { s as verdictBannerStyles } from "../VerdictBanner/styles";
import { formatBriefUsage } from "./helpers";
import { RISK_TONE, s } from "./styles";
import type { BriefSectionsState, BriefVerdictInfo } from "./types";

export function BriefSummaryPanel({ state }: { state: BriefSectionsState }) {
  const t = useTranslations("brief");
  const tVerdict = useTranslations("prReview");

  if (state.status === "no-agent") return null;

  if (state.status === "loading") {
    return (
      <section style={s.card}>
        <SectionLabel
          icon="Sparkles"
          right={
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              disabled
              aria-label={t("regenerate.ariaLabel")}
            >
              {t("regenerate.cta")}
            </Button>
          }
        >
          {t("title")}
        </SectionLabel>
        <Skeleton height={60} />
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section style={s.card}>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <ErrorState body={state.errorMessage ?? t("error.body")} onRetry={state.regenerate} />
      </section>
    );
  }

  if (state.status === "empty") {
    return (
      <section style={s.card}>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <EmptyState
          icon="Sparkles"
          title={t("empty.title")}
          body={t("empty.body")}
          cta={t("generate.cta")}
          onCta={state.generate}
          ctaLoading={state.isMutating}
        />
      </section>
    );
  }

  if (state.status === "ready" && state.brief) {
    const level = state.brief.risk_level;
    const tone = RISK_TONE[level];
    const levelLabel = t(`riskLevel.${level}`);
    const usage = formatBriefUsage(state.usage);

    return (
      <section style={s.card}>
        <SectionLabel
          icon="Sparkles"
          right={
            <div style={s.headerActions}>
              <div
                role="status"
                aria-label={t("riskLevel.aria", { level: levelLabel })}
                style={s.riskLevelBadgeWrap}
              >
                <Badge color={tone.color} bg={tone.bg}>
                  {levelLabel}
                </Badge>
              </div>
              <Button
                kind="secondary"
                size="sm"
                icon="RefreshCw"
                onClick={state.regenerate}
                loading={state.isMutating}
                aria-label={t("regenerate.ariaLabel")}
              >
                {t("regenerate.cta")}
              </Button>
            </div>
          }
        >
          {t("title")}
        </SectionLabel>
        {state.verdict && (
          <VerdictRow verdict={state.verdict} tVerdict={tVerdict} />
        )}
        <p style={s.what}>{state.brief.what}</p>
        <p style={s.why}>{state.brief.why}</p>
        {usage && (
          <div style={s.usage} aria-label={t("usage.aria")}>
            {usage.cost && <span>{usage.cost}</span>}
            {usage.tokens && <span>{usage.tokens}</span>}
          </div>
        )}
      </section>
    );
  }

  return null;
}

/** The merged verdict/findings/score row — reuses `VerdictBanner`'s own
 *  icon/color mapping and i18n strings so it reads identically to the
 *  Findings-tab rendering of the same run. Split out only for readability;
 *  it's still part of BriefSummaryPanel's single presentational contract
 *  (no data fetching, no state of its own). */
function VerdictRow({
  verdict,
  tVerdict,
}: {
  verdict: BriefVerdictInfo;
  tVerdict: ReturnType<typeof useTranslations>;
}) {
  const meta = VERDICT_META[verdict.verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[meta.icon];

  return (
    <div style={s.verdictRow}>
      <div style={s.verdictIconBox(meta.bg, meta.c)}>
        <VIcon size={18} />
      </div>
      <div style={s.verdictMain}>
        <div style={s.verdictTitleRow}>
          <span style={s.verdictLabel(meta.c)}>{tVerdict(`verdict.${meta.labelKey}`)}</span>
          <Badge color="var(--text-secondary)">
            {tVerdict("verdict.findingsCount", { count: verdict.findingsCount })}
            {verdict.blockers > 0 ? tVerdict("verdict.blockers", { count: verdict.blockers }) : ""}
          </Badge>
        </div>
      </div>
      {verdict.score != null && (
        <div style={verdictBannerStyles.scoreCol}>
          <CircularScore score={verdict.score} size={48} stroke={5} />
          <span style={verdictBannerStyles.scoreLabel}>{tVerdict("verdict.prScore")}</span>
        </div>
      )}
    </div>
  );
}
