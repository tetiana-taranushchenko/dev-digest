/* SmartDiffViewer — instructor-aligned risk ordering with exact inline
   findings. Fetching and routing stay in DiffTab; this component is
   presentational and emits the selected finding id. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import type {
  PrFile,
  ReviewRecord,
  SmartDiff,
  SmartDiffGroup,
} from "@devdigest/shared";
import {
  FileCard,
  type DiffCommentApi,
  type DiffLineFinding,
} from "@/components/diff-viewer";
import { ROLE_DESCRIPTION_KEY, ROLE_ICON, ROLE_TITLE_KEY } from "./constants";
import {
  buildFileMap,
  projectSmartDiffFindings,
  type SmartDiffFindingProjection,
} from "./helpers";
import { s } from "./styles";

export interface SmartDiffViewerProps {
  groups: SmartDiffGroup[];
  splitSuggestion: SmartDiff["split_suggestion"];
  /** Server-computed (`SmartDiff.review_tokens`) — see `smart-diff/service.ts`. */
  reviewTokens: SmartDiff["review_tokens"];
  files: PrFile[];
  reviews: ReviewRecord[];
  commenting?: DiffCommentApi;
  onFindingClick: (findingId: string) => void;
  /** When set, forces the group containing this file open (overriding the
   *  role-based default, e.g. "boilerplate" groups starting collapsed) and
   *  forces that file's own FileCard open regardless of its size — mirrors
   *  DiffViewer's targetFile handling for Blast Radius/Findings navigation. */
  targetFile?: string | null;
}

export function SmartDiffViewer({
  groups,
  splitSuggestion,
  reviewTokens,
  files,
  reviews,
  commenting,
  onFindingClick,
  targetFile,
}: SmartDiffViewerProps) {
  const t = useTranslations("smartDiff");
  const fileMap = React.useMemo(() => buildFileMap(files), [files]);
  const projection = React.useMemo(
    () => projectSmartDiffFindings(groups, reviews),
    [groups, reviews],
  );

  return (
    <div style={s.container}>
      {reviewTokens != null && (
        <div style={s.tokenStatus}>
          <Icon.Zap size={14} />
          {t("tokenStatus", { tokens: reviewTokens })}
        </div>
      )}

      {splitSuggestion.too_big && (
        <div style={s.splitBanner} role="status">
          <Icon.AlertTriangle size={14} />
          {t("splitBanner", { lines: splitSuggestion.total_lines })}
        </div>
      )}

      {groups.map((group) => (
        <SmartDiffGroupSection
          key={group.role}
          group={group}
          fileMap={fileMap}
          projection={projection}
          commenting={commenting}
          onFindingClick={onFindingClick}
          targetFile={targetFile}
        />
      ))}
    </div>
  );
}

function SmartDiffGroupSection({
  group,
  fileMap,
  projection,
  commenting,
  onFindingClick,
  targetFile,
}: {
  group: SmartDiffGroup;
  fileMap: Map<string, PrFile>;
  projection: SmartDiffFindingProjection;
  commenting?: DiffCommentApi;
  onFindingClick: (findingId: string) => void;
  targetFile?: string | null;
}) {
  const t = useTranslations("smartDiff");
  const containsTarget = targetFile != null && group.files.some((f) => f.path === targetFile);
  const [open, setOpen] = React.useState(group.role !== "boilerplate" || containsTarget);
  const RoleIcon = Icon[ROLE_ICON[group.role]];

  return (
    <section style={s.group}>
      <button
        type="button"
        style={s.groupHeader}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon.ChevronRight size={13} style={s.groupChevron(open)} />
        <RoleIcon size={13} style={s.groupIcon} />
        <span style={s.groupCopy}>
          <span style={s.groupTitle}>{t(ROLE_TITLE_KEY[group.role])}</span>
          <span style={s.groupDescription}>{t(ROLE_DESCRIPTION_KEY[group.role])}</span>
        </span>
        <span style={s.groupCount}>{t("groups.fileCount", { count: group.files.length })}</span>
      </button>

      {open && (
        <div style={s.groupFiles}>
          {group.files.map((file) => {
            const prFile = fileMap.get(file.path);
            if (!prFile) return null;
            const findingsByLine = projection.findingsByPath.get(file.path);

            return (
              <FileCard
                key={file.path}
                file={prFile}
                commenting={commenting}
                defaultOpen={file.path === targetFile ? true : undefined}
                findingsByLine={findingsByLine}
                onFindingClick={onFindingClick}
                findingAriaLabel={(finding: DiffLineFinding, path, line) =>
                  t("finding.ariaLabel", {
                    severity: finding.severity.toLowerCase(),
                    title: finding.title,
                    path,
                    line,
                  })
                }
                findingCountLabel={(count) => t("finding.fileCount", { count })}
                emphasizeLarge
                largeFileLabel={t("largeFile.label")}
                largeFileAriaLabel={t("largeFile.ariaLabel", {
                  path: file.path,
                  lines: file.additions + file.deletions,
                })}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
