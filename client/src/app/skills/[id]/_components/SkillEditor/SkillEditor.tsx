"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { EvalsTab } from "../../../../../components/eval-tab/EvalsTab";
import { useAgents } from "../../../../../lib/hooks/agents";
import { useSkillAgents, useSkills } from "../../../../../lib/hooks/skills";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

/** Thin wrapper so `useAgents`/`useSkills`/`useSkillAgents` (AC-39 orphan
 *  detection + AC-42's "linked to an enabled agent" check) are only called
 *  once the Evals tab actually mounts — mirrors `AgentEditor`'s
 *  `AgentEvalsTab` (`AgentEditor.tsx`). */
function SkillEvalsTab({ skill }: { skill: Skill }) {
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  const { data: links } = useSkillAgents(skill.id);

  // AC-42 — the skill's evals run through whichever currently-enabled agent
  // has it linked; disable running when none of its linked agents are
  // enabled (including when it has no linked agents at all).
  const canRun = (links ?? []).some((link) => agents?.some((a) => a.id === link.agent_id && a.enabled));

  return (
    <EvalsTab
      ownerKind="skill"
      ownerId={skill.id}
      ownerName={skill.name}
      agents={agents ?? []}
      skills={skills ?? []}
      canRun={canRun}
    />
  );
}

/** Skill Editor — Config/Context/Evals/Preview/Stats/Versions tabs. Tab
 *  state lives in ?tab= (owned by the page, not this component), mirroring
 *  the Agent Editor. */
export function SkillEditor({ skill, tab, onTab }: { skill: Skill; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("skills");
  const tEval = useTranslations("eval");
  const tabs = TABS.map((tb) => ({
    key: tb.key,
    // `evals` has no `skills.editor.tabs.evals` key — see constants.ts.
    label: tb.key === "evals" ? tEval("page.crumbEvals") : t(tb.labelKey),
    icon: tb.icon,
  }));

  let content: React.ReactNode;
  if (tab === "context") content = <ContextTab skill={skill} />;
  else if (tab === "evals") content = <SkillEvalsTab skill={skill} />;
  else if (tab === "preview") content = <PreviewTab skill={skill} />;
  else if (tab === "stats") content = <StatsTab skill={skill} />;
  else if (tab === "versions") content = <VersionsTab skill={skill} />;
  else content = <ConfigTab skill={skill} />;

  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>{content}</div>
    </div>
  );
}
