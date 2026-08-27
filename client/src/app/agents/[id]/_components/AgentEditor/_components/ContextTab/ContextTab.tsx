"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Agent } from "@devdigest/shared";
import { Badge } from "@devdigest/ui";
import { ContextDocPicker, CONTEXT_TOKEN_CAP_FALLBACK } from "../../../../../../../components/context-picker";
import { useContextFiles } from "../../../../../../../lib/hooks/core";
import { useSkills } from "../../../../../../../lib/hooks/skills";
import {
  useAgentContext,
  useAgentSkills,
  useLinkedSkillsContext,
  useSetAgentContext,
} from "../../../../../../../lib/hooks/agents";
import { useActiveRepo } from "../../../../../../../lib/repo-context";
import { useToast } from "../../../../../../../lib/toast";
import { ApiError } from "../../../../../../../lib/api";
import { combineAttached, totalTokens } from "./helpers";
import { s } from "./styles";

/**
 * Context tab — attaches Project Context documents to this agent via the
 * shared `ContextDocPicker` (T12), with drag-to-reorder so injection order
 * is explicit (AC-8).
 *
 * `ContextDocPicker`'s `attached` prop drives BOTH the interactive
 * checklist AND is exactly the ordered set it reports back via `onChange`
 * on every attach/detach/reorder — so it must be this agent's own direct
 * attachments (`useAgentContext`) only. Feeding it the combined
 * direct+inherited set (as an earlier version of this tab did) would
 * silently persist every inherited-only document as a direct attachment on
 * the next edit. This mirrors the Skill Editor's Context tab
 * (`app/skills/[id]/.../ContextTab`), which has always used its own
 * skill-only set for the same reason.
 *
 * The running *total* shown above the picker is still the combined direct +
 * enabled-linked-skill attached set, deduped by path (AC-10): this agent's
 * own attachments plus every enabled linked skill's own attached documents
 * (`useLinkedSkillsContext`, in `agent_skills.order`) — display-only,
 * computed via `combineAttached`/`totalTokens`, never passed to the picker.
 * The map-reduce cost-repeats note shows when this agent's strategy is
 * `"map-reduce"` (AC-11); it's independent of the attached set so it stays
 * wired straight through the picker's `mapReduce` prop.
 *
 * `ContextDocPicker` is rendered with `hideSummary` here because this tab's
 * own bar above already shows the combined total — without it, the picker
 * would additionally render its own internal bar computed from the
 * direct-only `attached` set, stacking two near-identical "N tokens total"
 * lines with different numbers and no explanation of the difference. Since
 * this tab's bar is now the *only* total shown, it uses the dedicated
 * `context.picker.combinedTotalTokens` copy (not the picker's own
 * `totalTokens`) so it reads unambiguously as the agent + linked skills
 * total on its own, without a second bar for contrast.
 */
export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const tc = useTranslations("context");
  const toast = useToast();
  const { repoId } = useActiveRepo();

  const filesQuery = useContextFiles(repoId);
  const agentContext = useAgentContext(agent.id);
  const { data: skillLinks } = useAgentSkills(agent.id);
  const { data: skills } = useSkills();
  const setContext = useSetAgentContext();

  const directAttached = agentContext.data ?? [];

  const enabledById = React.useMemo(() => {
    const m = new Map<string, boolean>();
    for (const sk of skills ?? []) m.set(sk.id, sk.enabled);
    return m;
  }, [skills]);

  const enabledLinkedSkillIds = React.useMemo(() => {
    if (!skillLinks) return [];
    return [...skillLinks]
      .sort((a, b) => a.order - b.order)
      .map((l) => l.skill_id)
      .filter((id) => enabledById.get(id) === true);
  }, [skillLinks, enabledById]);

  const skillContextResults = useLinkedSkillsContext(enabledLinkedSkillIds);
  const skillContextLoading = skillContextResults.some((r) => r.isLoading);
  const skillContextError = skillContextResults.some((r) => r.isError);

  // Display-only combined set (AC-10) — never passed to `ContextDocPicker`'s
  // `attached` prop. See the doc comment above.
  const combinedAttached = React.useMemo(
    () => combineAttached(directAttached, skillContextResults.map((r) => r.data ?? [])),
    [directAttached, skillContextResults],
  );
  const combinedTotal = React.useMemo(() => totalTokens(combinedAttached), [combinedAttached]);
  const overCap = combinedTotal > CONTEXT_TOKEN_CAP_FALLBACK;

  const onChange = (paths: string[]) => {
    setContext.mutate(
      { agentId: agent.id, paths },
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
      <div style={s.summaryBar}>
        <span style={s.summaryTotal}>{tc("picker.combinedTotalTokens", { tokens: combinedTotal })}</span>
        {overCap && (
          <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
            {tc("picker.overCapLabel")}
          </Badge>
        )}
      </div>
      {overCap && <div style={s.summaryHint}>{tc("picker.overCapHint", { cap: CONTEXT_TOKEN_CAP_FALLBACK })}</div>}
      <ContextDocPicker
        repoId={repoId}
        documents={filesQuery.data?.files ?? []}
        attached={directAttached}
        onChange={onChange}
        tokenCap={CONTEXT_TOKEN_CAP_FALLBACK}
        mapReduce={agent.strategy === "map-reduce"}
        loading={filesQuery.isLoading || agentContext.isLoading || skillContextLoading}
        loadError={filesQuery.isError || agentContext.isError || skillContextError}
        disabled={setContext.isPending}
        hideSummary
      />
    </div>
  );
}
