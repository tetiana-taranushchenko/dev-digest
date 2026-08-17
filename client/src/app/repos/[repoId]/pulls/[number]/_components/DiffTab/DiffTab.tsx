"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, SectionLabel } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { useCreatePrComment, usePrComments } from "@/lib/hooks/reviews";
import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { notify } from "@/lib/toast";
import type { PrFile, ReviewRecord, RunSummary } from "@devdigest/shared";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { buildFindingRoute } from "./helpers";

interface DiffTabProps {
  prId: string | null;
  repoId: string;
  prNumber: number;
  filesCount: number;
  additions: number;
  deletions: number;
  files: PrFile[];
  reviews: ReviewRecord[];
  runs: RunSummary[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({
  prId,
  repoId,
  prNumber,
  filesCount,
  additions,
  deletions,
  files,
  reviews,
  runs,
  canComment,
}: DiffTabProps) {
  const t = useTranslations("smartDiff");
  const router = useRouter();
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  const { data: smartDiff } = useSmartDiff(prId);
  const [mode, setMode] = React.useState<"original" | "smart">("original");
  const [showComments, setShowComments] = React.useState(false);
  const smartAvailable = !!smartDiff && smartDiff.groups.length > 0;

  React.useEffect(() => {
    if (!smartAvailable) setMode("original");
  }, [smartAvailable]);

  const commentCount = comments?.length ?? 0;
  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true);
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  const controls = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <div role="group" aria-label={t("mode.label")} style={{ display: "inline-flex", gap: 6 }}>
        <Button
          kind={mode === "smart" ? "primary" : "secondary"}
          size="sm"
          aria-pressed={mode === "smart"}
          disabled={!smartAvailable}
          onClick={() => setMode("smart")}
        >
          {t("mode.smart")}
        </Button>
        <Button
          kind={mode === "original" ? "primary" : "secondary"}
          size="sm"
          aria-pressed={mode === "original"}
          onClick={() => setMode("original")}
        >
          {t("mode.original")}
        </Button>
      </div>

      {commentCount > 0 && (
        <Button
          kind="ghost"
          size="sm"
          icon={showComments ? "EyeOff" : "Eye"}
          onClick={() => setShowComments((value) => !value)}
        >
          {showComments ? "Hide comments" : "Show comments"} ({commentCount})
        </Button>
      )}
    </div>
  );

  return (
    <section>
      <SectionLabel icon="Code" right={controls}>
        Files changed · {filesCount} files
      </SectionLabel>

      <div
        aria-label="Pull request diff summary"
        style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 18, fontSize: 13 }}
      >
        <span style={{ padding: "3px 8px", color: "var(--text-secondary)", background: "var(--bg-elevated)" }}>
          {t("summary.files", { count: filesCount })}
        </span>
        <span style={{ padding: "3px 8px", color: "var(--code-add-text)", background: "var(--code-add)" }}>
          +{additions}
        </span>
        <span style={{ padding: "3px 8px", color: "var(--code-del-text)", background: "var(--code-del)" }}>
          −{deletions}
        </span>
      </div>

      {mode === "smart" && smartAvailable ? (
        <SmartDiffViewer
          groups={smartDiff.groups}
          splitSuggestion={smartDiff.split_suggestion}
          files={files}
          reviews={reviews}
          runs={runs}
          commenting={commenting}
          onFindingClick={(findingId) => router.push(buildFindingRoute(repoId, prNumber, findingId))}
        />
      ) : (
        <DiffViewer
          files={files}
          commenting={commenting}
          emphasizeLargeFiles
          largeFileLabel={t("largeFile.label")}
          largeFileAriaLabel={(file, lines) => t("largeFile.ariaLabel", { path: file.path, lines })}
        />
      )}
    </section>
  );
}
