"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Chip, Badge, Button, Icon, Skeleton, ErrorState } from "@devdigest/ui";
import {
  useCommunitySkills,
  useImportCommunitySkill,
  type CommunitySkillEntry,
} from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { ApiError } from "../../../../../../lib/api";
import { s } from "./styles";

/** Community tab — search a small, curated, static catalog (no live GitHub
 *  search) and import a skill with one click. Import needs no preview step
 *  (the catalog entry already carries its full body); the result lands
 *  disabled + needs-vetting like any other community-sourced skill. */
export function CommunityTab({ onImported }: { onImported: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: entries, isLoading, isError, refetch } = useCommunitySkills({});
  const importSkill = useImportCommunitySkill();
  const [search, setSearch] = React.useState("");
  const [lang, setLang] = React.useState<string | null>(null);
  const [topic, setTopic] = React.useState<string | null>(null);
  const [importingSlug, setImportingSlug] = React.useState<string | null>(null);

  const all = entries ?? [];
  const languages = Array.from(new Set(all.map((e) => e.lang))).sort();
  const topics = Array.from(new Set(all.flatMap((e) => e.topics))).sort();

  const needle = search.trim().toLowerCase();
  const filtered = all.filter((e) => {
    if (needle && !`${e.name} ${e.desc}`.toLowerCase().includes(needle)) return false;
    if (lang && e.lang !== lang) return false;
    if (topic && !e.topics.includes(topic)) return false;
    return true;
  });

  const doImport = (entry: CommunitySkillEntry) => {
    setImportingSlug(entry.slug);
    importSkill.mutate(entry.slug, {
      onSuccess: (data) => {
        toast.success(t("file.success", { name: data.name }));
        onImported();
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : t("drawer.importFailed"));
        setImportingSlug(null);
      },
    });
  };

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={36} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </div>
    );
  }
  if (isError) {
    return <ErrorState title={t("community.loadError")} onRetry={() => refetch()} />;
  }

  return (
    <div style={s.wrap}>
      <div style={s.search}>
        <Icon.Search size={13} style={s.searchIcon} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("community.searchPlaceholder")}
          style={s.searchInput}
        />
      </div>

      <div style={s.chipRow}>
        <Chip active={lang === null} onClick={() => setLang(null)}>
          {t("community.allLanguages")}
        </Chip>
        {languages.map((l) => (
          <Chip key={l} active={lang === l} onClick={() => setLang(l === lang ? null : l)}>
            {l}
          </Chip>
        ))}
      </div>
      {topics.length > 0 && (
        <div style={s.chipRow}>
          {topics.map((tp) => (
            <Chip key={tp} active={topic === tp} onClick={() => setTopic(tp === topic ? null : tp)}>
              {tp}
            </Chip>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={s.emptyBox}>
          <div style={s.emptyTitle}>{t("community.noMatch.title")}</div>
          <div style={s.emptyBody}>{t("community.noMatch.body")}</div>
        </div>
      ) : (
        <div style={s.list}>
          {filtered.map((entry) => (
            <div key={entry.slug} style={s.card}>
              <div style={s.cardHeader}>
                <span style={s.cardName}>{entry.name}</span>
                <span style={s.stars}>
                  <Icon.Star size={12} style={s.starIcon} />
                  {entry.stars.toLocaleString()}
                </span>
              </div>
              <div style={s.cardDesc}>{entry.desc}</div>
              <div style={s.cardMeta}>
                <span style={s.repo}>{entry.repo}</span>
                <Badge color="var(--text-secondary)">{entry.lang}</Badge>
              </div>
              <div style={s.cardActions}>
                <Button
                  kind="secondary"
                  size="sm"
                  icon="Plus"
                  onClick={() => doImport(entry)}
                  disabled={importSkill.isPending && importingSlug === entry.slug}
                >
                  {importSkill.isPending && importingSlug === entry.slug
                    ? t("community.importing")
                    : t("community.import")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
