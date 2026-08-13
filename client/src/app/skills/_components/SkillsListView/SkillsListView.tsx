/* /skills — Skills list (A1). SkillCards + "Add Skill" entry point.
   Selecting a skill navigates to the editor at /skills/:id. "+ Add Skill"
   opens a dropdown MENU (Import from file / Import from URL / Search
   community skills / Create from scratch); picking an item opens the
   AddSkillDrawer MODAL on the matching tab — all 4 tabs stay reachable
   inside the modal itself too, the menu is just a shortcut to one of them. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Skeleton, Icon } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useSkills } from "../../../../lib/hooks/skills";
import { SkillCard } from "../SkillCard";
import { AddSkillDrawer, type AddSkillDrawerTab } from "../AddSkillDrawer";
import { filterSkills } from "./helpers";
import { s } from "./styles";

export function SkillsListView() {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const [search, setSearch] = React.useState("");
  const [drawerTab, setDrawerTab] = React.useState<AddSkillDrawerTab | null>(null);

  const list = filterSkills(skills ?? [], search);

  return (
    <AppShell crumb={[{ label: t("page.crumbLab") }, { label: t("page.crumbSkills") }]}>
      <div style={s.page}>
        <div style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("page.heading")}</h1>
          </div>
          <div style={s.search}>
            <Icon.Search size={13} style={s.searchIcon} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("page.searchPlaceholder")}
              style={s.searchInput}
            />
          </div>
          <Dropdown
            width={240}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("page.addSkill")}
              </Button>
            }
            items={[
              { label: t("page.menu.fromFile"), icon: "Upload", onClick: () => setDrawerTab("file") },
              { label: t("page.menu.fromUrl"), icon: "Link", onClick: () => setDrawerTab("url") },
              { label: t("page.menu.community"), icon: "Globe", onClick: () => setDrawerTab("community") },
              { divider: true },
              { label: t("page.menu.create"), icon: "Edit", onClick: () => setDrawerTab("create") },
            ]}
          />
        </div>

        {isLoading && (
          <div style={s.grid}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        )}
        {isError && <ErrorState body={t("page.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && list.length === 0 && (
          <EmptyState
            icon="Sparkles"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => setDrawerTab("create")}
          />
        )}
        {list.length > 0 && (
          <div style={s.grid}>
            {list.map((sk) => (
              <SkillCard key={sk.id} skill={sk} onClick={() => router.push(`/skills/${sk.id}`)} />
            ))}
          </div>
        )}
      </div>
      {drawerTab && <AddSkillDrawer initialTab={drawerTab} onClose={() => setDrawerTab(null)} />}
    </AppShell>
  );
}
