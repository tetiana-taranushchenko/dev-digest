/* RiskAreasPanel — "Risk Areas" section of the PR Brief, between IntentPanel
   and BlastRadiusPanel (AC-23/D11). Presentational: takes the shared `state`
   prop from `useBriefSections` (owned by OverviewTab, T10) — never calls the
   hook itself, and never shows stale content while loading/erroring (AC-25/
   AC-28). */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { Risk } from "@devdigest/shared";
import { RISK_TONE, s } from "./styles";
import type { BriefSectionsState } from "./types";

function RiskRow({ risk }: { risk: Risk }) {
  const t = useTranslations("brief");
  const [expanded, setExpanded] = useState(false);
  const tone = RISK_TONE[risk.severity];

  return (
    <div style={s.riskRow}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        style={s.riskHeader}
      >
        <Icon.ChevronRight size={14} style={s.chevron(expanded)} />
        <span style={{ ...s.severityLabel, color: tone.color, background: tone.bg }}>
          {t(`riskAreas.severity.${risk.severity}`)}
        </span>
        <span style={s.riskTitle}>{risk.title}</span>
      </button>

      {expanded && (
        <div style={s.riskBody}>
          <p style={s.riskExplanation}>{risk.explanation}</p>
          {risk.file_refs.length > 0 && (
            // Plain, non-navigating monospace text — Risk.file_refs carries
            // no line, so there is nothing to route to (T9 notes).
            <div className="mono" style={s.fileRefs}>
              {risk.file_refs.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RiskAreasPanel({ state }: { state: BriefSectionsState }) {
  const t = useTranslations("brief");

  if (state.status === "no-agent" || state.status === "empty" || state.status === "error") {
    return null;
  }

  if (state.status === "loading") {
    return (
      <section style={s.card}>
        <SectionLabel icon="AlertTriangle">{t("riskAreas.title")}</SectionLabel>
        <Skeleton height={60} />
      </section>
    );
  }

  if (state.status === "ready" && state.brief) {
    const { risks } = state.brief;
    return (
      <section style={s.card}>
        <SectionLabel icon="AlertTriangle">{t("riskAreas.title")}</SectionLabel>
        {risks.length === 0 ? (
          // AC-16: zero surviving risks is a valid outcome — reuse the
          // existing `noRisks` key (T9 notes) rather than a near-duplicate.
          <div style={s.emptyText}>{t("noRisks")}</div>
        ) : (
          <div style={s.riskList}>
            {risks.map((risk, index) => (
              <RiskRow key={`${risk.title}-${index}`} risk={risk} />
            ))}
          </div>
        )}
      </section>
    );
  }

  return null;
}
