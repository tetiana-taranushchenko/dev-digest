"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon } from "@devdigest/ui";
import type { PriorPr } from "@devdigest/shared";
import { formatPriorPrAge } from "../helpers";
import { s } from "../styles";

/** Collapsed-by-default "Prior PRs touching these files" row at the bottom of
 *  the BLAST RADIUS card. Reference data only (REQ-5) — never part of the
 *  blast-radius graph, so it renders independently of `state`. Hidden
 *  entirely when there's nothing to show (REQ-7): a `null`/undefined
 *  response (server doesn't compute this) and a real empty list both read
 *  the same way to the user, so both hide the row. */
export function PriorPrsRow({
  priorPrs,
  repoId,
}: {
  priorPrs: PriorPr[] | null | undefined;
  repoId: string;
}) {
  const t = useTranslations("blast");

  // Narrow, local concern (like SymbolRow's badge-row toggles) — not lifted
  // into BlastRadiusPanel's expandedSymbols map.
  const [expanded, setExpanded] = useState(false);

  if (!priorPrs || priorPrs.length === 0) return null;

  return (
    <div style={s.priorPrsRow}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        style={s.priorPrsHeader}
      >
        <Icon.ChevronRight size={14} style={s.chevron(expanded)} />
        <span>{t("priorPrs.title")}</span>
        <Badge>{priorPrs.length}</Badge>
      </button>

      {expanded && (
        <div style={s.priorPrsList}>
          {priorPrs.map((pr) => (
            <Link key={pr.number} href={`/repos/${repoId}/pulls/${pr.number}`} style={s.priorPrsItem}>
              <span className="mono">#{pr.number}</span>
              <span>{pr.title}</span>
              <span style={s.priorPrsAge}>{formatPriorPrAge(pr.updated_at)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
