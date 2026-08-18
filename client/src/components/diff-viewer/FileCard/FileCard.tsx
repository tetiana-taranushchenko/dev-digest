/* FileCard — one collapsible file in the diff: header (path, +/- stat, comment
   count) and, when open, its parsed lines plus any outdated comments. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type { PrFile } from "@/lib/types";
import { AUTO_EXPAND_MAX_LINES, LARGE_FILE_CHANGED_LINES } from "../constants";
import { parsePatch, type Line } from "../helpers";
import {
  buildThreads,
  keysForLine,
  partitionThreads,
  type CommentThread,
  type DiffCommentApi,
} from "../comments";
import { s, chevronFor } from "../styles";
import { CodeLine, type DiffLineFinding } from "../CodeLine";
import { OutdatedComments } from "../OutdatedComments";

/** Threads anchored to a given parsed line (RIGHT=new, LEFT=old). */
function threadsForLine(ln: Line, matched: Map<string, CommentThread[]>): CommentThread[] {
  if (matched.size === 0) return [];
  const out: CommentThread[] = [];
  for (const key of keysForLine(ln)) {
    const list = matched.get(key);
    if (list) out.push(...list);
  }
  return out;
}

export interface FileCardProps {
  file: PrFile;
  commenting?: DiffCommentApi;
  /** Overrides today's `AUTO_EXPAND_MAX_LINES` auto-expand rule when set. */
  defaultOpen?: boolean;
  findingsByLine?: ReadonlyMap<number, readonly DiffLineFinding[]>;
  onFindingClick?: (findingId: string) => void;
  findingAriaLabel?: (finding: DiffLineFinding, path: string, line: number) => string;
  findingCountLabel?: (count: number) => string;
  emphasizeLarge?: boolean;
  largeFileLabel?: string;
  largeFileAriaLabel?: string;
}

export function FileCard({
  file,
  commenting,
  defaultOpen,
  findingsByLine,
  onFindingClick,
  findingAriaLabel,
  findingCountLabel,
  emphasizeLarge = false,
  largeFileLabel,
  largeFileAriaLabel,
}: FileCardProps) {
  const t = useTranslations("shell");
  const changedLines = (file.additions ?? 0) + (file.deletions ?? 0);
  const isLarge = emphasizeLarge && changedLines > LARGE_FILE_CHANGED_LINES;
  const [open, setOpen] = React.useState(
    defaultOpen ?? changedLines <= AUTO_EXPAND_MAX_LINES
  );
  const lines = React.useMemo(() => parsePatch(file.patch), [file.patch]);
  const renderedFindingCount = React.useMemo(() => {
    if (!findingsByLine) return 0;

    const renderedNewLines = new Set<number>();
    let count = 0;
    for (const line of lines) {
      if (line.newNo == null || renderedNewLines.has(line.newNo)) continue;
      renderedNewLines.add(line.newNo);
      count += findingsByLine.get(line.newNo)?.length ?? 0;
    }
    return count;
  }, [findingsByLine, lines]);

  // Group this file's comments into threads, then split into ones we can anchor
  // to a rendered line vs. "outdated" (GitHub dropped the line / it's not here).
  const comments = commenting?.comments;
  const { matched, outdated } = React.useMemo(() => {
    if (!comments) return { matched: new Map<string, CommentThread[]>(), outdated: [] };
    const fileThreads = buildThreads(comments.filter((c) => c.path === file.path));
    const renderedKeys = new Set<string>();
    for (const ln of lines) for (const k of keysForLine(ln)) renderedKeys.add(k);
    return partitionThreads(fileThreads, renderedKeys);
  }, [comments, file.path, lines]);

  const commentCount = commenting
    ? commenting.comments.filter((c) => c.path === file.path).length
    : 0;

  return (
    <div style={isLarge ? { ...s.fileCard, ...s.fileCardLarge } : s.fileCard}>
      <div onClick={() => setOpen((o) => !o)} style={s.fileHeader}>
        <Icon.ChevronRight size={13} style={chevronFor(open)} />
        <Icon.FileText size={14} style={s.fileIcon} />
        <span className="mono" style={isLarge ? { ...s.filePath, ...s.filePathLarge } : s.filePath}>
          {file.path}
        </span>
        <span className="mono tnum" style={s.fileStat}>
          <span style={s.addText}>+{file.additions}</span>{" "}
          <span style={s.delText}>−{file.deletions}</span>
        </span>
        {commentCount > 0 && (
          <span style={s.fileMetaBadge}>
            <Icon.MessageSquare size={12} />
            {commentCount}
          </span>
        )}
        {findingCountLabel && renderedFindingCount > 0 && (
          <span style={s.fileMetaBadge}>{findingCountLabel(renderedFindingCount)}</span>
        )}
        {isLarge && largeFileLabel && (
          <span role="status" style={s.largeFileBadge} aria-label={largeFileAriaLabel}>
            <Icon.AlertTriangle size={12} />
            {largeFileLabel}
          </span>
        )}
      </div>
      {open && (
        <div style={s.fileBody}>
          {lines.length === 0 ? (
            <div style={s.noDiff}>{t("diffViewer.noDiffText")}</div>
          ) : (
            lines.map((ln, i) => (
              <CodeLine
                key={i}
                ln={ln}
                path={file.path}
                threads={threadsForLine(ln, matched)}
                commenting={commenting}
                findings={ln.newNo != null ? findingsByLine?.get(ln.newNo) : undefined}
                onFindingClick={onFindingClick}
                findingAriaLabel={findingAriaLabel}
              />
            ))
          )}
          {commenting && commenting.showComments && <OutdatedComments threads={outdated} />}
        </div>
      )}
    </div>
  );
}
