/* /skills/:id — Skill Editor (A1). Left skill list + editor pane. Tab state
   lives in ?tab=. Ported from the Agent Editor page (agents/[id]/page.tsx). */
"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, ErrorState, Skeleton, Icon, Badge } from "@devdigest/ui";
import { AppShell } from "../../../components/app-shell";
import { SkillCard } from "../_components/SkillCard";
import { SkillEditor } from "./_components/SkillEditor";
import { AddSkillDrawer, type AddSkillDrawerTab } from "../_components/AddSkillDrawer";
import { useSkills, useSkill } from "../../../lib/hooks/skills";
import { ApiError } from "../../../lib/api";

const VALID_TABS = ["config", "preview", "stats", "versions"];

export default function SkillEditorPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { id } = params;
  const t = useTranslations("skills");

  const { data: skills } = useSkills();
  const { data: skill, isLoading, isError, error, refetch } = useSkill(id);
  const [drawerTab, setDrawerTab] = React.useState<AddSkillDrawerTab | null>(null);

  const tab = VALID_TABS.includes(search.get("tab") ?? "") ? search.get("tab")! : "config";
  const setTab = (tb: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", tb);
    router.replace(`/skills/${id}?${sp.toString()}`);
  };

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumbSkills"), href: "/skills" },
    { label: skill?.name ?? t("detail.crumbSkill") },
  ];

  if (isError || (!isLoading && !skill)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title={t("detail.notFound.title")}
          body={error instanceof ApiError ? error.message : t("detail.notFound.body")}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <div style={{ display: "flex", height: "calc(100vh - 52px)" }}>
        {/* left: skill list */}
        <div
          style={{
            width: 280,
            flexShrink: 0,
            // minHeight: 0 lets this column's own overflow:auto list below
            // actually engage instead of growing past the viewport (see the
            // matching note in SkillEditor/styles.ts for why this matters).
            minHeight: 0,
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "var(--bg-surface)",
          }}
        >
          <div style={{ padding: "16px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{t("page.heading")}</h1>
              <Dropdown
                width={230}
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
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 12px 12px" }}>
            {(skills ?? []).map((sk) => (
              <SkillCard
                key={sk.id}
                skill={sk}
                active={sk.id === id}
                showDelete={false}
                onClick={() => router.push(`/skills/${sk.id}?tab=${tab}`)}
              />
            ))}
          </div>
        </div>

        {/* editor */}
        {isLoading || !skill ? (
          <div style={{ flex: 1, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
            <Skeleton height={24} width={240} />
            <Skeleton height={200} />
          </div>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 28px 0", flexShrink: 0 }}>
              <Icon.Sparkles size={18} style={{ color: "var(--accent)" }} />
              <h1 style={{ fontSize: 18, fontWeight: 700 }}>{skill.name}</h1>
              <Badge color="var(--text-secondary)">{t(`listItem.type.${skill.type}`)}</Badge>
              <Badge color="var(--text-secondary)" mono>
                {t("preview.version", { version: skill.version })}
              </Badge>
              {skill.injection_flagged ? (
                <span title={skill.injection_reason ?? t("listItem.injectionTitle")}>
                  <Badge color="var(--crit)" bg="var(--crit-bg)" icon="AlertOctagon">
                    {t("listItem.injectionDetected")}
                  </Badge>
                </span>
              ) : (
                !skill.enabled && <Badge color="var(--text-muted)">{t("preview.disabled")}</Badge>
              )}
            </div>
            <SkillEditor skill={skill} tab={tab} onTab={setTab} />
          </div>
        )}
      </div>
      {drawerTab && <AddSkillDrawer initialTab={drawerTab} onClose={() => setDrawerTab(null)} />}
    </AppShell>
  );
}
