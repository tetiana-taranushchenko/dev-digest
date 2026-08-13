/* FindingsPopover — hover preview listing a set of findings (severity,
   title, category, file:line, confidence, rationale). Used both by the PR
   list's FINDINGS column and the PR detail Timeline's per-run row. Renders
   into a portal (not `position: absolute` in place) because both call sites
   sit inside a container that clips overflow for its rounded border. */
"use client";

import React from "react";
import { createPortal } from "react-dom";
import { SeverityBadge, CategoryTag, ConfidenceNum, type Severity, type Category } from "@devdigest/ui";
import type { Finding } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { s } from "./styles";

function lineLabel(f: Finding): string {
  return f.start_line === f.end_line ? String(f.start_line) : `${f.start_line}-${f.end_line}`;
}

/** file:line link — same hover affordance as MonoLink (@devdigest/ui): accent
 *  color + underline on hover, plain otherwise. Not MonoLink itself because
 *  this needs a smaller font and ellipsis truncation for the tight popup width. */
function FileLineLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
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
      style={s.fileLineLink(hover)}
    >
      {children}
    </a>
  );
}

/** One finding's row inside the popup: severity + title + category, then
 *  file:line + confidence, then a truncated rationale. */
function FindingPopoverRow({
  finding: f,
  first,
  repoFullName,
  headSha,
  onClick,
}: {
  finding: Finding;
  first: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const fileHref =
    repoFullName && headSha
      ? githubBlobUrl(repoFullName, headSha, f.file, f.start_line, f.end_line)
      : undefined;
  return (
    <div onClick={onClick} style={s.row(first, Boolean(onClick))}>
      <div style={s.rowHeader}>
        <SeverityBadge severity={f.severity as Severity} compact />
        <span style={s.rowTitle}>{f.title}</span>
        <CategoryTag category={f.category as Category} />
      </div>
      <div style={s.rowMeta}>
        {fileHref ? (
          <FileLineLink href={fileHref}>
            {f.file}:{lineLabel(f)}
          </FileLineLink>
        ) : (
          <span className="mono" style={s.rowFileFallback}>
            {f.file}:{lineLabel(f)}
          </span>
        )}
        <ConfidenceNum value={f.confidence} />
      </div>
      <div style={s.rowRationale}>{f.rationale}</div>
    </div>
  );
}

const POPUP_WIDTH = 340;
const POPUP_MAX_HEIGHT = 420;
// Below this much room, a scrollable popup opening downward would feel too
// cramped to read — flip it above the row instead. Below that, it just
// scrolls internally (it doesn't need to fully fit to be usable).
const POPUP_MIN_HEIGHT = 200;
const POPUP_GAP = 8;
const VIEWPORT_MARGIN = 16;

type Place = { left: number; maxHeight: number; top?: number; bottom?: number };

/** `position: fixed` is clipped by the viewport, not scrolled — so this
 *  decides above/below and clamps width from the trigger's rect, once,
 *  before the popup ever renders (no flicker, no measuring pass needed). */
function computePlace(rect: DOMRect): Place {
  const spaceBelow = window.innerHeight - rect.bottom - POPUP_GAP;
  const spaceAbove = rect.top - POPUP_GAP;
  const openAbove = spaceBelow < POPUP_MIN_HEIGHT && spaceAbove > spaceBelow;
  const left = Math.min(rect.left, window.innerWidth - POPUP_WIDTH - VIEWPORT_MARGIN);
  const maxHeight = Math.min(POPUP_MAX_HEIGHT, openAbove ? spaceAbove : spaceBelow);
  return {
    left,
    maxHeight,
    ...(openAbove
      ? { bottom: window.innerHeight - rect.top + POPUP_GAP }
      : { top: rect.bottom + POPUP_GAP }),
  };
}

export function FindingsPopover({
  trigger,
  items,
  total,
  heading,
  repoFullName,
  headSha,
  onFindingClick,
}: {
  trigger: React.ReactNode;
  items: Finding[];
  total: number;
  /** Overrides the default "{n} finding(s)" header text, e.g. "in this run". */
  heading?: string;
  /** owner/repo + head sha — used to deep-link a finding's file:line to GitHub. */
  repoFullName?: string | null;
  headSha?: string | null;
  /** Clicking a finding (not its file:line link) jumps to its card in
   *  "Review runs" below — or, when this popover lives on a different page
   *  (e.g. the PR list), navigates there first. */
  onFindingClick?: (findingId: string) => void;
}) {
  const [place, setPlace] = React.useState<Place | null>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  // Popup renders in a portal, outside the trigger's DOM subtree — moving the
  // cursor from trigger to popup briefly leaves both, so closing is delayed
  // (not immediate) to survive that gap and let the mouse reach the popup.
  const show = () => {
    clearCloseTimer();
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPlace(computePlace(rect));
  };
  const scheduleHide = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setPlace(null), 200);
  };
  React.useEffect(() => clearCloseTimer, []);

  const defaultHeading = `${total} finding${total === 1 ? "" : "s"}`;

  return (
    <div
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      style={s.anchor}
    >
      {trigger}
      {place && items.length > 0 &&
        createPortal(
          <div
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleHide}
            style={s.popup(place, POPUP_WIDTH)}
          >
            <div style={s.heading}>{heading ?? defaultHeading}</div>
            {items.map((f, i) => (
              <FindingPopoverRow
                key={f.id}
                finding={f}
                first={i === 0}
                repoFullName={repoFullName}
                headSha={headSha}
                onClick={
                  onFindingClick
                    ? (e) => {
                        e.stopPropagation();
                        setPlace(null);
                        onFindingClick(f.id);
                      }
                    : undefined
                }
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
