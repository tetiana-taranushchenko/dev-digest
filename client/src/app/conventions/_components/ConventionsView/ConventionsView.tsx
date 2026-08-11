"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useActiveRepo } from "../../../../lib/repo-context";
import {
  useConventions,
  useExtractConventions,
} from "../../../../lib/hooks/conventions";
import { useToast } from "../../../../lib/toast";
import { ApiError } from "../../../../lib/api";
import { ConventionCard } from "./ConventionCard";
import { CreateSkillModal } from "./CreateSkillModal";
import { s } from "./styles";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const toast = useToast();
  const { repoId, activeRepo, reposLoaded } = useActiveRepo();
  const query = useConventions(repoId);
  const extract = useExtractConventions(repoId ?? "");
  const [showModal, setShowModal] = React.useState(false);
  const candidates = query.data ?? [];
  const approved = candidates.filter((candidate) => candidate.status === "approved").length;

  const runExtraction = () => {
    if (!repoId) return;
    if (candidates.length > 0 && !window.confirm(t("page.rescanConfirm"))) return;
    extract.mutate(undefined, {
      onSuccess: (items) => toast.success(t("page.extracted", { count: items.length })),
      onError: (error) =>
        toast.error(error instanceof ApiError ? error.message : t("page.extractionFailed")),
    });
  };

  return (
    <AppShell
      crumb={[
        { label: t("page.crumbLab") },
        { label: t("page.crumbConventions") },
      ]}
    >
      <main style={s.page}>
        <header style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>
              {t("page.headingPrefix")}
              {activeRepo?.name ?? t("page.repoFallback")}
            </h1>
            <div style={s.subtitle}>{t("page.subtitle")}</div>
          </div>
          {repoId && (
            <div style={s.actions}>
              <Button
                kind="secondary"
                icon="RefreshCw"
                onClick={runExtraction}
                loading={extract.isPending}
              >
                {candidates.length > 0 ? t("page.rescan") : t("page.runExtraction")}
              </Button>
              <Button
                kind="primary"
                icon="Sparkles"
                disabled={approved === 0}
                onClick={() => setShowModal(true)}
              >
                {t("page.createSkill", { count: approved })}
              </Button>
            </div>
          )}
        </header>

        {!reposLoaded && <Skeleton height={240} />}
        {reposLoaded && !repoId && (
          <EmptyState
            icon="GitBranch"
            title={t("page.noRepo.title")}
            body={t("page.noRepo.body")}
          />
        )}
        {repoId && query.isLoading && <Skeleton height={240} />}
        {repoId && query.isError && (
          <ErrorState
            body={query.error instanceof ApiError ? query.error.message : t("page.loadError")}
            onRetry={() => query.refetch()}
          />
        )}
        {repoId && !query.isLoading && !query.isError && candidates.length === 0 && (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={runExtraction}
          />
        )}
        {repoId && candidates.length > 0 && activeRepo && (
          <>
            <div style={s.summary}>
              <span>{t("page.candidateCount", { count: candidates.length })}</span>
              <span>·</span>
              <span>{t("page.approvedCount", { count: approved })}</span>
            </div>
            <div style={s.list}>
              {candidates.map((candidate) => (
                <ConventionCard
                  key={candidate.id}
                  candidate={candidate}
                  repoId={repoId}
                  repoFullName={activeRepo.full_name}
                  fallbackRef={activeRepo.default_branch}
                />
              ))}
            </div>
          </>
        )}
      </main>
      {showModal && repoId && (
        <CreateSkillModal
          repoId={repoId}
          repoName={activeRepo?.name ?? t("page.repoFallback")}
          onClose={() => setShowModal(false)}
        />
      )}
    </AppShell>
  );
}
