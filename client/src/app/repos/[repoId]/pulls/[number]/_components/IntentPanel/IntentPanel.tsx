/* IntentPanel — INTENT panel on the PR Overview tab (T11). Renders the
   derived PR intent (summary + in/out-of-scope lists + confidence badge +
   sources), or an empty state with a "Derive intent" CTA before the first
   classification, or a non-blocking inline error. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, EmptyState, ErrorState, Skeleton, Button } from "@devdigest/ui";
import { usePrIntent, useClassifyIntent } from "@/lib/hooks";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { ConfidenceBadge } from "./_components/ConfidenceBadge";
import { ScopeList } from "./_components/ScopeList";
import { describeSource } from "./helpers";
import { s } from "./styles";

export function IntentPanel({ prId }: { prId: string | null }) {
  const t = useTranslations("intent");
  const toast = useToast();
  const { data, isLoading, isError, error, refetch } = usePrIntent(prId);
  const classify = useClassifyIntent(prId ?? "");

  const deriveIntent = () => {
    classify.mutate(undefined, {
      onError: (mutationError) =>
        toast.error(
          mutationError instanceof ApiError ? mutationError.message : t("empty.deriveFailed"),
        ),
    });
  };

  if (!prId) return null;

  if (isLoading) {
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        <Skeleton height={80} />
      </section>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <section>
        <SectionLabel icon="Target">{t("title")}</SectionLabel>
        {notFound ? (
          <EmptyState
            icon="Target"
            title={t("empty.title")}
            body={t("empty.body")}
            cta={t("empty.cta")}
            onCta={deriveIntent}
            ctaLoading={classify.isPending}
          />
        ) : (
          <ErrorState
            body={error instanceof ApiError ? error.message : t("error.body")}
            onRetry={() => refetch()}
          />
        )}
      </section>
    );
  }

  if (!data) return null;

  const confidenceLabel = t(`confidence.${data.confidence}`);
  const sourcesText = data.sources
    .map((source) =>
      describeSource(source, t(`sources.signal.${source.signal}`), t("sources.notFetched")),
    )
    .join(", ");

  return (
    <section>
      <SectionLabel
        icon="Target"
        right={
          <div style={s.headerActions}>
            <ConfidenceBadge
              tier={data.confidence}
              label={confidenceLabel}
              reason={data.confidence_reason}
              ariaLabel={t("confidence.aria", { tier: confidenceLabel })}
            />
            <Button
              kind="secondary"
              size="sm"
              icon="RefreshCw"
              onClick={deriveIntent}
              loading={classify.isPending}
              aria-label={t("recompute.ariaLabel")}
            >
              {t("recompute.cta")}
            </Button>
          </div>
        }
      >
        {t("title")}
      </SectionLabel>

      <div style={s.summary}>&ldquo;{data.intent}&rdquo;</div>

      <div style={s.scopeColumns}>
        <ScopeList heading={t("inScope")} items={data.in_scope} icon="Check" iconColor="var(--ok)" />
        <ScopeList heading={t("outOfScope")} items={data.out_of_scope} icon="X" iconColor="var(--crit)" />
      </div>

      {data.sources.length > 0 && (
        <div style={s.sources}>
          {t("sources.label")}: {sourcesText}
        </div>
      )}
    </section>
  );
}
