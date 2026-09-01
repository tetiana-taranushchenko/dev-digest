/* AgentEditor — agent config + skills + context + evals editor. Config
   (model + system prompt), Skills (linked-skill picker + drag-to-reorder),
   Context (attached Project Context docs + drag-to-reorder), and Evals
   (T11) are wired up; later lessons add Stats/CI tabs. Tab state lives in
   ?tab=. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { EvalsTab } from "../../../../../components/eval-tab/EvalsTab";
import { useAgents } from "../../../../../lib/hooks/agents";
import { useSkills } from "../../../../../lib/hooks/skills";
import { ConfigTab } from "./_components/ConfigTab";
import { SkillsTab } from "./_components/SkillsTab";
import { ContextTab } from "./_components/ContextTab";
import { TABS } from "./constants";
import { s } from "./styles";

/** Thin wrapper so `useAgents`/`useSkills` (needed for EvalsTab's AC-39
 *  orphan detection) are only called once the Evals tab actually mounts —
 *  keeping them out of `AgentEditor`'s own body matters because the other
 *  tabs' tests mock `lib/hooks/agents` with just the hooks they use
 *  (`AgentEditor.test.tsx`), and Rules of Hooks forbids calling these
 *  conditionally inline. */
function AgentEvalsTab({ agent }: { agent: Agent }) {
  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  return (
    <EvalsTab
      ownerKind="agent"
      ownerId={agent.id}
      ownerName={agent.name}
      agents={agents ?? []}
      skills={skills ?? []}
    />
  );
}

export function AgentEditor({ agent, tab, onTab }: { agent: Agent; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("agents");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));
  return (
    <div style={s.wrap}>
      <div style={s.tabsBar}>
        <Tabs tabs={tabs} value={tab} onChange={onTab} pad="0 24px" />
      </div>
      <div style={s.body}>
        {tab === "skills" ? (
          <SkillsTab agent={agent} />
        ) : tab === "context" ? (
          <ContextTab agent={agent} />
        ) : tab === "evals" ? (
          <AgentEvalsTab agent={agent} />
        ) : (
          <ConfigTab agent={agent} />
        )}
      </div>
    </div>
  );
}
