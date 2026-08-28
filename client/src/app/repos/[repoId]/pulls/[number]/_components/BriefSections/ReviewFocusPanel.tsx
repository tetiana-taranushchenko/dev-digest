/* ReviewFocusPanel — "Review Focus" section of the PR Brief, between
   BlastRadiusPanel and the Description block (AC-23/D11). Presentational:
   takes the shared `state` prop from `useBriefSections` (owned by
   OverviewTab, T10) plus the PR identity/files needed to resolve navigation
   (AC-26/AC-27) — never calls the hook itself. */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrFile, ReviewFocusItem } from "@devdigest/shared";
import { resolveReviewFocusDestination } from "./helpers";
import { s } from "./styles";
import type { BriefSectionsState } from "./types";

interface ReviewFocusRowProps {
  item: ReviewFocusItem;
  files: PrFile[];
  repoId: string;
  prNumber: number;
}

function ReviewFocusRow({ item, files, repoId, prNumber }: ReviewFocusRowProps) {
  const t = useTranslations("brief");
  const router = useRouter();
  const destination = resolveReviewFocusDestination({
    file: item.file,
    line: item.line,
    files,
    repoId,
    prNumber,
  });
  const label = `${item.file}:${item.line}`;

  return (
    <button
      type="button"
      onClick={() => {
        if (destination.kind === "in-app") router.push(destination.route);
      }}
      style={s.focusItem}
      aria-label={t("reviewFocus.itemAriaLabel", { file: item.file, line: item.line })}
    >
      <Icon.ArrowRight size={14} style={s.focusIcon} />
      <span style={s.focusContent}>
        <span className="mono" style={s.focusFile}>
          {label}
        </span>
        <span style={s.focusReason}>{item.reason}</span>
        {destination.kind === "not-in-diff" && (
          <span style={s.notInDiff}>{t("reviewFocus.notInDiff")}</span>
        )}
      </span>
    </button>
  );
}

interface ReviewFocusPanelProps {
  state: BriefSectionsState;
  repoId: string;
  prNumber: number;
  repoFullName?: string | null;
  headSha?: string | null;
  files: PrFile[];
}

export function ReviewFocusPanel({ state, repoId, prNumber, files }: ReviewFocusPanelProps) {
  const t = useTranslations("brief");

  if (state.status === "no-agent" || state.status === "empty" || state.status === "error") {
    return null;
  }

  if (state.status === "loading") {
    return (
      <section style={s.card}>
        <SectionLabel icon="Eye">{t("reviewFocus.title")}</SectionLabel>
        <Skeleton height={60} />
      </section>
    );
  }

  if (state.status === "ready" && state.brief) {
    const items = state.brief.review_focus;
    return (
      <section style={s.card}>
        <SectionLabel icon="Eye">{t("reviewFocus.title")}</SectionLabel>
        {items.length === 0 ? (
          <div style={s.emptyText}>{t("reviewFocus.empty")}</div>
        ) : (
          <div style={s.focusList}>
            {items.map((item, index) => (
              <ReviewFocusRow
                key={`${item.file}:${item.line}:${index}`}
                item={item}
                files={files}
                repoId={repoId}
                prNumber={prNumber}
              />
            ))}
          </div>
        )}
      </section>
    );
  }

  return null;
}
