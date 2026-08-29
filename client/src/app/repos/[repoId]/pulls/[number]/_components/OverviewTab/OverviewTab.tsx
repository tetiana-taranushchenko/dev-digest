"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { PrFile } from "@devdigest/shared";
import { IntentPanel } from "../IntentPanel";
import { BlastRadiusPanel } from "../BlastRadiusPanel";
import { BriefSummaryPanel, RiskAreasPanel, ReviewFocusPanel, useBriefSections } from "../BriefSections";
import { s } from "./styles";

interface OverviewTabProps {
  prId: string | null;
  prBody: string | null | undefined;
  repoId: string;
  prNumber: number;
  repoFullName?: string | null;
  headSha?: string | null;
  files: PrFile[];
}

/** The single call site for `useBriefSections` (T10) — its returned
 *  `state` is passed down to all three Brief sections as a prop, so there is
 *  exactly one `useMutation()`/`useQuery()` pair for the whole Brief feature
 *  in the tree. No other component may call the hook.
 *  Section order deliberately deviates from the plan's D11 (Review Focus
 *  moved before Blast Radius, per product direction after implementation). */
export function OverviewTab({ prId, prBody, repoId, prNumber, repoFullName, headSha, files }: OverviewTabProps) {
  const briefState = useBriefSections(prId);

  return (
    <>
      <BriefSummaryPanel state={briefState} />

      <IntentPanel prId={prId} />

      <RiskAreasPanel state={briefState} />

      <ReviewFocusPanel
        state={briefState}
        repoId={repoId}
        prNumber={prNumber}
        repoFullName={repoFullName}
        headSha={headSha}
        files={files}
      />

      <BlastRadiusPanel
        prId={prId}
        repoId={repoId}
        prNumber={prNumber}
        repoFullName={repoFullName}
        headSha={headSha}
        files={files}
      />

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
