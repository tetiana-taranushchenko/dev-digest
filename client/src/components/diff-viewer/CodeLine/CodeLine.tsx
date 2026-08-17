/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import type { Severity } from "@devdigest/shared";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { type Line } from "../helpers";
import { findingButtonFor, lineRowFor, lineRowWithFinding, lineSignFor, s } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings = [],
  onFindingClick,
  findingAriaLabel,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  findings?: readonly DiffLineFinding[];
  onFindingClick?: (findingId: string) => void;
  findingAriaLabel?: (finding: DiffLineFinding, path: string, line: number) => string;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const worstSeverity = findings.reduce<Severity | null>((worst, finding) => {
    if (worst === "CRITICAL" || finding.severity === "CRITICAL") return "CRITICAL";
    if (worst === "WARNING" || finding.severity === "WARNING") return "WARNING";
    return "SUGGESTION";
  }, null);

  return (
    <div
      style={cs.rowWrap}
      data-diff-line={ln.newNo != null ? `${path}:${ln.newNo}` : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={worstSeverity ? lineRowWithFinding(ln.kind, worstSeverity) : lineRowFor(ln.kind)}>
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {findings.length > 0 && ln.newNo != null && (
          <span style={s.findingRail}>
            {findings.map((finding) => (
              <button
                key={finding.id}
                type="button"
                title={finding.title}
                aria-label={
                  findingAriaLabel?.(finding, path, ln.newNo!) ??
                  `Open ${finding.severity.toLowerCase()} finding at ${path}:${ln.newNo}`
                }
                style={findingButtonFor(finding.severity)}
                onClick={() => onFindingClick?.(finding.id)}
              >
                {finding.severity.toLowerCase()}
              </button>
            ))}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}

export interface DiffLineFinding {
  id: string;
  severity: Severity;
  title: string;
}
