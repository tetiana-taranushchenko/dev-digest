"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Tabs } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { ConfigTab } from "./_components/ConfigTab";
import { ContextTab } from "./_components/ContextTab";
import { PreviewTab } from "./_components/PreviewTab";
import { StatsTab } from "./_components/StatsTab";
import { VersionsTab } from "./_components/VersionsTab";
import { TABS } from "./constants";
import { s } from "./styles";

/** Skill Editor — Config/Context/Preview/Stats/Versions tabs. Tab state lives
 *  in ?tab= (owned by the page, not this component), mirroring the Agent
 *  Editor. */
export function SkillEditor({ skill, tab, onTab }: { skill: Skill; tab: string; onTab: (t: string) => void }) {
  const t = useTranslations("skills");
  const tabs = TABS.map((tb) => ({ key: tb.key, label: t(tb.labelKey), icon: tb.icon }));

  let content: React.ReactNode;
  if (tab === "context") content = <ContextTab skill={skill} />;
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
