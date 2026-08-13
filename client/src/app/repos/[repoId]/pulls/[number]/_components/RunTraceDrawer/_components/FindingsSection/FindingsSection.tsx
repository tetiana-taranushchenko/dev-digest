/* FindingsSection — the persisted findings of THIS run (same data as the
   "Review runs" list), rendered inside a collapsible TraceSection. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { githubBlobUrl } from "@/lib/github-urls";

const SEV_COLOR: Record<string, string> = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--accent)",
};

/** file:line link — same hover affordance as MonoLink (@devdigest/ui): accent
 *  color + underline on hover, plain otherwise. Not MonoLink itself because
 *  this needs a smaller font and block layout to match the section's rows. */
function FileLineLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [hover, setHover] = React.useState(false);
  return (
    <a
      className="mono"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={s.findingsSectionFileLine(hover)}
    >
      {children}
    </a>
  );
}

export function FindingsSection({
  findings,
  repoFullName,
  headSha,
}: {
  findings: FindingRecord[];
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("runs");
  return (
    <TraceSection
      icon="AlertOctagon"
      title={t("trace.findings")}
      right={<Badge color="var(--text-muted)">{findings.length}</Badge>}
    >
      {findings.length === 0 ? (
        <span style={s.noToolCalls}>{t("trace.noFindings")}</span>
      ) : (
        <div style={s.findingsSectionList}>
          {findings.map((f) => {
            const fileHref =
              repoFullName && headSha
                ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
                : undefined;
            const lineLabel = `${f.file}:${f.start_line}${f.end_line !== f.start_line ? `-${f.end_line}` : ""}`;
            return (
            <div key={f.id} style={s.findingsSectionCard}>
              <div style={s.findingsSectionHeader}>
                <Badge color={SEV_COLOR[f.severity] ?? "var(--text-muted)"} bg="transparent">
                  {f.severity}
                </Badge>
                <span style={s.findingsSectionTitle}>{f.title}</span>
              </div>
              {fileHref ? (
                <FileLineLink href={fileHref}>{lineLabel}</FileLineLink>
              ) : (
                <div className="mono" style={s.findingsSectionFileLineFallback}>
                  {lineLabel}
                </div>
              )}
              <div style={s.findingsSectionRationale}>{f.rationale}</div>
              {f.suggestion && (
                <div style={s.findingsSectionSuggestion}>
                  <strong>{t("trace.suggestedFix")} </strong>
                  {f.suggestion}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </TraceSection>
  );
}
