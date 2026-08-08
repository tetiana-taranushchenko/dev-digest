"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Icon, CircularScore, SeverityBadge } from "@devdigest/ui";
import type { RunSummary, PrCommit, FindingRecord } from "@devdigest/shared";
import { formatCost, formatTokenCount } from "@/lib/format";
import { SEVERITY_ORDER, tallySeverity } from "@/lib/severity";
import { FindingsPopover } from "@/components/findings-popover";
import { outcomeOf, tsOf, type TimelineItem } from "./helpers";
import { s } from "./styles";

const EMPTY_FINDINGS: FindingRecord[] = [];

/** One run's findings summary: severity badges + hover popup when there are
 *  any, otherwise the plain "N findings · M blockers" text. Memoized so
 *  clicking the severity filter above (which re-renders the whole timeline)
 *  doesn't re-tally every run's findings on every render. */
const RunFindingsSummary = React.memo(function RunFindingsSummary({
  findings,
  findingsCount,
  blockers,
  repoFullName,
  headSha,
  onGoToFinding,
}: {
  findings: FindingRecord[];
  findingsCount: number | null;
  blockers: number | null;
  repoFullName?: string | null;
  headSha?: string | null;
  onGoToFinding?: (findingId: string) => void;
}) {
  const t = useTranslations("prReview");
  const counts = tallySeverity(findings);
  const nonZero = SEVERITY_ORDER.filter((sev) => counts[sev] > 0);

  if (nonZero.length === 0) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        {t("runStatus.findings", { count: findingsCount ?? 0 })}
        {(blockers ?? 0) > 0 ? t("runStatus.blockers", { count: blockers ?? 0 }) : ""}
      </div>
    );
  }

  const total = nonZero.reduce((sum, sev) => sum + counts[sev], 0);
  return (
    <FindingsPopover
      items={findings}
      total={total}
      heading={`${total} finding${total === 1 ? "" : "s"} in this run`}
      repoFullName={repoFullName}
      headSha={headSha}
      onFindingClick={onGoToFinding}
      trigger={nonZero.map((sev) => (
        <SeverityBadge key={sev} severity={sev} count={counts[sev]} compact />
      ))}
    />
  );
});

/**
 * PR timeline — every agent run interleaved with the PR's commits, newest-first
 * and DB-backed so it survives reload. Showing commits between runs makes it
 * clear which commit each review ran against. Failed runs show their error
 * inline; clicking a run row opens its trace.
 *
 * The badge reflects the review OUTCOME, not just the run lifecycle: a finished
 * run that found blockers reads "rejected" (red), never a green "done". Outcome
 * is derived from the denormalized blocker/finding counts on the run row, so it
 * matches the CI gate (deterministic) rather than the model's verdict.
 */

export function RunHistory({
  runs,
  commits = [],
  findingsByRunId,
  onOpenTrace,
  onGoToReview,
  onGoToFinding,
  onDelete,
  repoFullName,
  headSha,
}: {
  runs: RunSummary[];
  commits?: PrCommit[];
  /** This run's full findings, for the "N findings" hover preview below. */
  findingsByRunId?: Map<string, FindingRecord[]>;
  /** Open the trace + log drawer for a run (the logs icon). */
  onOpenTrace: (runId: string) => void;
  /** Jump to this run's inline review accordion below (clicking the agent name). */
  onGoToReview?: (runId: string) => void;
  /** Jump to a specific finding's card below (clicking a finding in the popover). */
  onGoToFinding?: (findingId: string) => void;
  onDelete?: (runId: string) => void;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const t = useTranslations("prReview");
  if (runs.length === 0 && commits.length === 0) return null;

  const items: TimelineItem[] = [
    ...runs.map((run) => ({ kind: "run" as const, ts: tsOf(run.ran_at), run })),
    ...commits.map((commit) => ({
      kind: "commit" as const,
      ts: tsOf(commit.committed_at),
      commit,
    })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item) => {
        if (item.kind === "commit") {
          const c = item.commit;
          return (
            <div key={`commit:${c.sha}`} style={s.commitRow}>
              <Icon.GitCommit size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
                {c.sha.slice(0, 7)}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={c.message}
              >
                {c.message.split("\n")[0]}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{c.author}</span>
              {c.committed_at && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                  {new Date(c.committed_at).toLocaleTimeString()}
                </span>
              )}
            </div>
          );
        }

        const r = item.run;
        const o = outcomeOf(r);
        const settled = r.status === "done";
        return (
          <div key={`run:${r.run_id}`} style={s.row}>
            <Badge color={o.color} bg={o.bg} icon={o.icon}>
              {t(`runStatus.${o.key}`)}
            </Badge>
            {settled && r.score != null && <CircularScore score={r.score} size={30} stroke={3} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                <button
                  type="button"
                  onClick={() => onGoToReview?.(r.run_id)}
                  title={t("timeline.goToReview")}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    font: "inherit",
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    cursor: onGoToReview ? "pointer" : "default",
                    textDecoration: onGoToReview ? "underline" : "none",
                    textDecorationStyle: "dotted",
                    textUnderlineOffset: 3,
                  }}
                >
                  {r.agent_name ?? "Agent"}
                </button>{" "}
                <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
                  {r.provider}/{r.model}
                </span>
              </div>
              {r.status === "failed" && r.error && (
                <div
                  style={{ fontSize: 12, color: "var(--crit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={r.error}
                >
                  {r.error}
                </div>
              )}
              {settled && (
                <RunFindingsSummary
                  findings={findingsByRunId?.get(r.run_id) ?? EMPTY_FINDINGS}
                  findingsCount={r.findings_count}
                  blockers={r.blockers}
                  repoFullName={repoFullName}
                  headSha={headSha}
                  onGoToFinding={onGoToFinding}
                />
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
              {r.ran_at && <span>{new Date(r.ran_at).toLocaleTimeString()}</span>}
              {settled && (
                <span className="mono">
                  {formatTokenCount(r.tokens_in, r.tokens_out)} · {formatCost(r.cost_usd)}
                </span>
              )}
            </div>
            <button
              type="button"
              title={t("timeline.openTrace")}
              aria-label={t("timeline.openTrace")}
              onClick={() => onOpenTrace(r.run_id)}
              style={s.iconBtn}
            >
              <Icon.FileText size={13} />
            </button>
            {onDelete && r.status !== "running" && (
              <span
                role="button"
                aria-label={t("timeline.deleteRun")}
                title={t("timeline.deleteRun")}
                onClick={() => onDelete(r.run_id)}
                style={{ display: "inline-flex", padding: 3, borderRadius: 5, color: "var(--text-muted)", flexShrink: 0, cursor: "pointer" }}
              >
                <Icon.Trash size={13} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
