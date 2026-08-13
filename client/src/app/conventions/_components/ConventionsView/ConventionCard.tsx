"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, SelectInput, TextInput } from "@devdigest/ui";
import type {
  ConventionCandidate,
  ConventionCategory,
  ConventionStatus,
} from "@devdigest/shared";
import { githubBlobUrl } from "../../../../lib/github-urls";
import { useUpdateConvention } from "../../../../lib/hooks/conventions";
import { useToast } from "../../../../lib/toast";
import { ApiError } from "../../../../lib/api";
import { s } from "./styles";

const CATEGORY_OPTIONS: ConventionCategory[] = [
  "naming",
  "formatting",
  "imports",
  "typing",
  "async",
  "errors",
  "architecture",
  "testing",
  "api",
  "other",
];

export function ConventionCard({
  candidate,
  repoId,
  repoFullName,
  fallbackRef,
}: {
  candidate: ConventionCandidate;
  repoId: string;
  repoFullName: string;
  fallbackRef: string;
}) {
  const t = useTranslations("conventions");
  const toast = useToast();
  const update = useUpdateConvention(repoId);
  const [editing, setEditing] = React.useState(false);
  const [rule, setRule] = React.useState(candidate.rule);
  const [category, setCategory] = React.useState<ConventionCategory>(candidate.category);

  const beginEdit = () => {
    setRule(candidate.rule);
    setCategory(candidate.category);
    setEditing(true);
  };

  const cancelEdit = () => {
    setRule(candidate.rule);
    setCategory(candidate.category);
    setEditing(false);
  };

  const mutate = (patch: { status?: ConventionStatus; rule?: string; category?: ConventionCategory }) =>
    update.mutate(
      { id: candidate.id, patch },
      {
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : t("card.updateFailed")),
      },
    );

  const save = () => {
    update.mutate(
      { id: candidate.id, patch: { rule: rule.trim(), category } },
      {
        onSuccess: () => setEditing(false),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : t("card.updateFailed")),
      },
    );
  };

  const decide = (status: ConventionStatus) => {
    mutate({ status: candidate.status === status ? "pending" : status });
  };

  const confidence = Math.round(candidate.confidence * 100);
  const evidenceUrl = githubBlobUrl(
    repoFullName,
    candidate.evidence_ref || fallbackRef,
    candidate.evidence_path,
    candidate.evidence_line,
  );

  return (
    <article style={s.card}>
      <div style={s.cardTop}>
        <div style={s.cardMain}>
          {editing ? (
            <>
              <div style={s.editGrid}>
                <SelectInput
                  value={category}
                  onChange={(value) => setCategory(value as ConventionCategory)}
                  options={CATEGORY_OPTIONS.map((value) => ({
                    value,
                    label: t(`categories.${value}`),
                  }))}
                  mono={false}
                />
                <TextInput value={rule} onChange={setRule} />
              </div>
              <div style={s.editActions}>
                <Button kind="ghost" size="sm" onClick={cancelEdit}>
                  {t("card.cancel")}
                </Button>
                <Button
                  kind="primary"
                  size="sm"
                  onClick={save}
                  loading={update.isPending}
                  disabled={rule.trim().length < 8}
                >
                  {t("card.save")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div style={s.category}>{t(`categories.${candidate.category}`)}</div>
              <div style={s.rule}>{candidate.rule}</div>
            </>
          )}
        </div>
        {!editing && (
          <div style={s.decision}>
            <Button kind="ghost" size="sm" icon="Edit" onClick={beginEdit}>
              {t("card.edit")}
            </Button>
            <Button
              kind={candidate.status === "approved" ? "primary" : "secondary"}
              size="sm"
              icon="Check"
              onClick={() => decide("approved")}
              disabled={update.isPending}
            >
              {t("card.approve")}
            </Button>
            <Button
              kind={candidate.status === "rejected" ? "danger" : "ghost"}
              size="sm"
              icon="X"
              onClick={() => decide("rejected")}
              disabled={update.isPending}
            >
              {t("card.reject")}
            </Button>
          </div>
        )}
      </div>

      <div style={s.evidence}>
        <a href={evidenceUrl} target="_blank" rel="noreferrer" style={s.evidenceLink}>
          {candidate.evidence_path}:{candidate.evidence_line} ↗
        </a>
        <pre style={s.code}>{candidate.evidence_snippet}</pre>
      </div>
      <div style={s.meta}>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {t("card.confidence")} {confidence}%
        </span>
        <span style={s.confidenceTrack}>
          <span
            style={{
              display: "block",
              width: `${confidence}%`,
              height: "100%",
              background: confidence >= 80 ? "var(--ok)" : "var(--warn)",
            }}
          />
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {t(`statuses.${candidate.status}`)}
        </span>
      </div>
    </article>
  );
}
