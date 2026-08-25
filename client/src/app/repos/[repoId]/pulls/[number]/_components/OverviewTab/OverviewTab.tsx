"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import type { PrFile } from "@devdigest/shared";
import { IntentPanel } from "../IntentPanel";
import { BlastRadiusPanel } from "../BlastRadiusPanel";
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

export function OverviewTab({ prId, prBody, repoId, prNumber, repoFullName, headSha, files }: OverviewTabProps) {
  return (
    <>
      <IntentPanel prId={prId} />

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
