"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { DownstreamImpact, PrFile } from "@devdigest/shared";
import { CallerRow } from "./CallerRow";
import { s } from "../styles";

/** Endpoint/cron badge rows are shown truncated to this many entries by
 *  default — a "hub" file (e.g. a composition root) can legitimately fan
 *  out to 20-30+ endpoints, which reads as clutter rather than signal.
 *  Crons get a lower cap since they're typically a much shorter list. */
const ENDPOINTS_BADGE_LIMIT = 6;
const CRONS_BADGE_LIMIT = 4;

/** One `downstream[]` entry — declaring file, caller count, and a
 *  collapsible list of callers + affected endpoint/cron badges. */
export function SymbolRow({
  impact,
  expanded,
  onToggle,
  files,
  repoId,
  prNumber,
  repoFullName,
  headSha,
}: {
  impact: DownstreamImpact;
  expanded: boolean;
  onToggle: () => void;
  files: PrFile[];
  repoId: string;
  prNumber: number;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("blast");
  const hasFacts = impact.endpoints_affected.length > 0 || impact.crons_affected.length > 0;

  // Each badge row's expand/collapse is a narrow, local concern (unlike the
  // caller list's `expanded`/`onToggle`, which is controlled from the
  // parent) — so it's local useState here rather than threaded as a prop.
  const [endpointsExpanded, setEndpointsExpanded] = useState(false);
  const [cronsExpanded, setCronsExpanded] = useState(false);

  const visibleEndpoints = endpointsExpanded
    ? impact.endpoints_affected
    : impact.endpoints_affected.slice(0, ENDPOINTS_BADGE_LIMIT);
  const hiddenEndpointsCount = impact.endpoints_affected.length - ENDPOINTS_BADGE_LIMIT;

  const visibleCrons = cronsExpanded ? impact.crons_affected : impact.crons_affected.slice(0, CRONS_BADGE_LIMIT);
  const hiddenCronsCount = impact.crons_affected.length - CRONS_BADGE_LIMIT;

  return (
    <div style={s.symbolRow}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} style={s.symbolHeader}>
        <Icon.ChevronRight size={14} style={s.chevron(expanded)} />
        <span className="mono" style={s.symbolName}>
          {impact.symbol}()
        </span>
        <span style={s.symbolFile}>{t("symbolFile", { file: impact.file })}</span>
        <span style={s.callerCount}>{t("callerCount", { count: impact.caller_count })}</span>
      </button>

      {expanded && (
        <div style={s.callerList}>
          {impact.callers.map((caller) => (
            <CallerRow
              key={`${caller.file}:${caller.line}:${caller.name}`}
              caller={caller}
              files={files}
              repoId={repoId}
              prNumber={prNumber}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}

          {!hasFacts && impact.callers.length === 0 && (
            <div style={s.noDownstream}>{t("graph.empty")}</div>
          )}

          {impact.endpoints_affected.length > 0 && (
            <div style={s.badgeRow}>
              <span style={s.badgeRowLabel}>{t("endpointsLabel")}</span>
              {visibleEndpoints.map((endpoint) => (
                <Badge key={endpoint} mono>
                  {endpoint}
                </Badge>
              ))}
              {hiddenEndpointsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setEndpointsExpanded((prev) => !prev)}
                  style={s.badgeToggle}
                >
                  {endpointsExpanded ? t("showLess") : t("showMore", { count: hiddenEndpointsCount })}
                </button>
              )}
            </div>
          )}

          {impact.crons_affected.length > 0 && (
            <div style={s.badgeRow}>
              <span style={s.badgeRowLabel}>{t("stat.crons")}</span>
              {visibleCrons.map((cron) => (
                <Badge key={cron} icon="Clock" mono>
                  {cron}
                </Badge>
              ))}
              {hiddenCronsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setCronsExpanded((prev) => !prev)}
                  style={s.badgeToggle}
                >
                  {cronsExpanded ? t("showLess") : t("showMore", { count: hiddenCronsCount })}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
