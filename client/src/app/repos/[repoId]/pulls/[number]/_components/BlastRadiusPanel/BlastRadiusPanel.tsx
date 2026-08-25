/* BlastRadiusPanel — BLAST RADIUS card on the PR Overview tab (T9/REQ-6).
   Renders `usePrBlastRadius(prId)` as a Tree (collapsible SymbolRow list) or
   Graph (BlastForceGraph) view, with explicit empty/partial/degraded states so a
   thin index never reads as "nothing found" (REQ-4). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, Icon, SectionLabel, Skeleton } from "@devdigest/ui";
import type { PrFile } from "@devdigest/shared";
import { usePrBlastRadius } from "@/lib/hooks/blast";
import { SymbolRow } from "./_components/SymbolRow";
import { BlastForceGraph } from "./_components/BlastForceGraph";
import { PriorPrsRow } from "./_components/PriorPrsRow";
import { computeBlastStats, reasonMessageKey, type BlastStats } from "./helpers";
import { s } from "./styles";

/** Compact "<> 2 symbols  ↳ 14 callers  ⊕ 3 endpoints  ⏱ 1 cron" metadata row,
 *  rendered right below the header (REQ-4: real counts stay visible even in
 *  the partial/degraded case, not just the fully-healthy one). */
function BlastStatsRow({ stats }: { stats: BlastStats }) {
  const t = useTranslations("blast");
  return (
    <div style={s.statsRow}>
      <span style={s.statItem}>
        <Icon.Code size={13} />
        {stats.symbols} {t("stat.symbols")}
      </span>
      <span style={s.statItem}>
        <Icon.CornerDownRight size={13} />
        {stats.callers} {t("stat.callers")}
      </span>
      <span style={s.statItem}>
        <Icon.Globe size={13} />
        {stats.endpoints} {t("stat.endpoints")}
      </span>
      <span style={s.statItem}>
        <Icon.Clock size={13} />
        {stats.crons} {t("stat.crons")}
      </span>
    </div>
  );
}

export function BlastRadiusPanel({
  prId,
  repoId,
  prNumber,
  repoFullName,
  headSha,
  files,
}: {
  prId: string | null;
  repoId: string;
  prNumber: number;
  repoFullName?: string | null;
  headSha?: string | null;
  files: PrFile[];
}) {
  const t = useTranslations("blast");
  const { data, isLoading } = usePrBlastRadius(prId);
  const [view, setView] = React.useState<"tree" | "graph">("tree");
  const [expandedSymbols, setExpandedSymbols] = React.useState<Record<string, boolean>>({});

  if (!prId) return null;

  const toggle = (
    <div role="group" aria-label={t("title")} style={s.viewToggle}>
      <Button
        kind={view === "tree" ? "primary" : "secondary"}
        size="sm"
        aria-pressed={view === "tree"}
        onClick={() => setView("tree")}
      >
        {t("view.tree")}
      </Button>
      <Button
        kind={view === "graph" ? "primary" : "secondary"}
        size="sm"
        aria-pressed={view === "graph"}
        onClick={() => setView("graph")}
      >
        {t("view.graph")}
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <section style={s.card}>
        <SectionLabel icon="Zap" right={toggle}>
          {t("title")}
        </SectionLabel>
        <Skeleton height={80} />
      </section>
    );
  }

  if (!data) return null;

  if (data.state === "empty") {
    return (
      <section style={s.card}>
        <SectionLabel icon="Zap" right={toggle}>
          {t("title")}
        </SectionLabel>
        <EmptyState icon="Zap" title={t("empty.title")} body={t("empty.body")} />
        <PriorPrsRow priorPrs={data.prior_prs} repoId={repoId} />
      </section>
    );
  }

  const isNoticeable = data.state === "partial" || data.state === "degraded";
  const reasonKey = isNoticeable ? reasonMessageKey(data.reason) : null;

  return (
    <section style={s.card}>
      <SectionLabel icon="Zap" right={toggle}>
        {t("title")}
      </SectionLabel>

      <BlastStatsRow stats={computeBlastStats(data)} />

      {isNoticeable && (
        <div role="status" style={s.stateNotice(data.state as "partial" | "degraded")}>
          <span style={s.stateNoticeTitle}>{t(`state.${data.state}`)}</span>
          <span>{reasonKey ? t(reasonKey) : data.reason_text}</span>
        </div>
      )}

      {view === "graph" ? (
        <BlastForceGraph
          downstream={data.downstream}
          files={files}
          repoId={repoId}
          prNumber={prNumber}
          repoFullName={repoFullName}
          headSha={headSha}
        />
      ) : data.downstream.length === 0 ? (
        <p style={s.noDownstream}>{t("noDownstream", { count: data.changed_symbols.length })}</p>
      ) : (
        <div style={s.symbolList}>
          {data.downstream.map((impact) => (
            <SymbolRow
              key={impact.symbol}
              impact={impact}
              expanded={!!expandedSymbols[impact.symbol]}
              onToggle={() =>
                setExpandedSymbols((current) => ({ ...current, [impact.symbol]: !current[impact.symbol] }))
              }
              files={files}
              repoId={repoId}
              prNumber={prNumber}
              repoFullName={repoFullName}
              headSha={headSha}
            />
          ))}
        </div>
      )}

      <PriorPrsRow priorPrs={data.prior_prs} repoId={repoId} />
    </section>
  );
}
