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
      style={{
        display: "block",
        fontSize: 11.5,
        color: hover ? "var(--accent-text)" : "var(--text-muted)",
        textDecoration: hover ? "underline" : "none",
        textUnderlineOffset: 2,
        marginBottom: 6,
      }}
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {findings.map((f) => {
            const fileHref =
              repoFullName && headSha
                ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
                : undefined;
            const lineLabel = `${f.file}:${f.start_line}${f.end_line !== f.start_line ? `-${f.end_line}` : ""}`;
            return (
            <div
              key={f.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                background: "var(--bg-surface)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Badge color={SEV_COLOR[f.severity] ?? "var(--text-muted)"} bg="transparent">
                  {f.severity}
                </Badge>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{f.title}</span>
              </div>
              {fileHref ? (
                <FileLineLink href={fileHref}>{lineLabel}</FileLineLink>
              ) : (
                <div className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 6 }}>
                  {lineLabel}
                </div>
              )}
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                {f.rationale}
              </div>
              {f.suggestion && (
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 6 }}>
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
