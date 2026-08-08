/* ReviewRunAccordion — one collapsible review RUN (a single agent's pass over
   the PR). Header shows agent + verdict + counts + score + when it ran; the
   body holds that run's VerdictBanner summary and its own FindingsPanel. A PR
   can have many runs (different agents / re-runs over time) — each is separate
   and collapsible so older runs don't bury the latest. */
"use client";

import React from "react";
import { Icon, Badge } from "@devdigest/ui";
import type { ReviewRecord, Verdict, Severity } from "@devdigest/shared";
import { FindingsPanel } from "../FindingsPanel";
import { VerdictBanner } from "../VerdictBanner";
import { useDeleteReview } from "../../../../../../../lib/hooks/reviews";
import { s } from "./styles";

const VERDICT_COLOR: Record<string, string> = {
  request_changes: "var(--crit)",
  comment: "var(--warn)",
  approve: "var(--ok)",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function ReviewRunAccordion({
  review,
  prId,
  defaultOpen = false,
  repoFullName,
  headSha,
  targetRunId = null,
  targetNonce = 0,
  targetFindingId = null,
  targetFindingNonce = 0,
  severityFilter = null,
}: {
  review: ReviewRecord;
  prId: string;
  defaultOpen?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  /** When this matches review.run_id, the accordion opens and scrolls into view
   *  (driven from the Timeline: clicking an agent name navigates here). */
  targetRunId?: string | null;
  targetNonce?: number;
  /** When this run's findings include this id, the accordion opens and scrolls
   *  into view too (driven from a findings popover: clicking a finding). */
  targetFindingId?: string | null;
  targetFindingNonce?: number;
  /** When set, the body's FindingsPanel shows only findings of this severity. */
  severityFilter?: Severity | null;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const containsTargetFinding =
    targetFindingId != null && review.findings.some((f) => f.id === targetFindingId);
  React.useEffect(() => {
    if ((review.run_id && review.run_id === targetRunId) || containsTargetFinding) {
      setOpen(true);
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRunId, targetNonce, targetFindingId, targetFindingNonce, review.run_id]);
  const del = useDeleteReview(prId);
  const findings = review.findings;
  const blockers = findings.filter((f) => f.severity === "CRITICAL" && !f.dismissed_at).length;
  const verdictColor = review.verdict ? VERDICT_COLOR[review.verdict] ?? "var(--text-muted)" : "var(--text-muted)";

  return (
    <div
      ref={rootRef}
      id={review.run_id ? `review-run-${review.run_id}` : undefined}
      style={s.root}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen((o) => !o);
        }}
        style={s.header}
      >
        <Icon.Cpu size={15} style={s.headerIcon} />
        <span style={s.agentName}>{review.agent_name ?? "Agent"}</span>
        {review.verdict && (
          <Badge color={verdictColor} bg="transparent">
            {review.verdict.replace("_", " ")}
          </Badge>
        )}
        <span style={s.metaText}>
          {findings.length} finding{findings.length === 1 ? "" : "s"}
          {blockers > 0 ? ` · ${blockers} blocker${blockers === 1 ? "" : "s"}` : ""}
        </span>
        <span style={s.spacer} />
        {review.score != null && (
          <Badge mono color="var(--text-secondary)">
            {review.score}
          </Badge>
        )}
        <span className="mono" style={s.when}>
          {formatWhen(review.created_at)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete this "${review.agent_name ?? "agent"}" review run and its findings?`)) {
              del.mutate(review.id);
            }
          }}
          disabled={del.isPending}
          title="Delete this review run"
          aria-label="Delete this review run"
          style={s.deleteBtn(del.isPending)}
        >
          <Icon.Trash size={14} style={s.deleteIcon(del.isPending)} />
        </button>
        <Icon.ChevronDown size={16} style={s.chevron(open)} />
      </div>

      {open && (
        <div style={s.body}>
          {review.verdict && (
            <div style={s.verdictWrap}>
              <VerdictBanner
                verdict={review.verdict as Verdict}
                summary={review.summary}
                score={review.score}
                findingsCount={findings.length}
                blockers={blockers}
                agentName={review.agent_name}
              />
            </div>
          )}
          <FindingsPanel
            findings={findings}
            prId={prId}
            repoFullName={repoFullName}
            headSha={headSha}
            severityFilter={severityFilter}
            targetFindingId={targetFindingId}
            targetFindingNonce={targetFindingNonce}
          />
        </div>
      )}
    </div>
  );
}

export default ReviewRunAccordion;
