"use client";

import { useTranslations } from "next-intl";
import type { Skill } from "@devdigest/shared";
import { ContextDocPicker, CONTEXT_TOKEN_CAP_FALLBACK } from "../../../../../../../components/context-picker";
import { useContextFiles } from "../../../../../../../lib/hooks/core";
import { useSkillContext, useSetSkillContext } from "../../../../../../../lib/hooks/skills";
import { useActiveRepo } from "../../../../../../../lib/repo-context";
import { useToast } from "../../../../../../../lib/toast";
import { ApiError } from "../../../../../../../lib/api";
import { s } from "./styles";

/**
 * Context tab — attaches Project Context documents to this skill via the
 * shared `ContextDocPicker` (T12), with drag-to-reorder so injection order
 * is explicit (AC-8). Unlike the Agent Editor's Context tab (T15), the
 * running total here covers ONLY this skill's own attached documents
 * (AC-10, second clause) — it is never combined with any other skill's or
 * agent's set, and `mapReduce` is intentionally omitted (skills don't have a
 * review strategy). Toggling/reordering persists the resulting path list to
 * the skill as paths only, never bodies (AC-7). An attached path that no
 * longer resolves against the current clone is shown as missing, not
 * dropped (AC-9).
 */
export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { repoId } = useActiveRepo();

  const filesQuery = useContextFiles(repoId);
  const skillContext = useSkillContext(skill.id);
  const setContext = useSetSkillContext();

  const onChange = (paths: string[]) => {
    setContext.mutate(
      { skillId: skill.id, paths },
      {
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("context.saveFailed")),
      },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("context.title")}</h2>
      </div>
      <ContextDocPicker
        repoId={repoId}
        documents={filesQuery.data?.files ?? []}
        attached={skillContext.data ?? []}
        onChange={onChange}
        tokenCap={CONTEXT_TOKEN_CAP_FALLBACK}
        loading={filesQuery.isLoading || skillContext.isLoading}
        loadError={filesQuery.isError || skillContext.isError}
        disabled={setContext.isPending}
      />
    </div>
  );
}
