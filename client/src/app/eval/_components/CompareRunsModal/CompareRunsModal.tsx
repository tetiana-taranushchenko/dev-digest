"use client";

import React from "react";
import { Button, Modal, SectionLabel } from "@devdigest/ui";
import type { EvalRunRecord } from "@devdigest/shared";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { useSetAgentSkills, useUpdateAgent } from "../../../../lib/hooks/agents";
import { useToast } from "../../../../lib/toast";
import { CompareMetricsRow } from "./_components/CompareMetricsRow";
import { SystemPromptDiff } from "./_components/SystemPromptDiff";
import {
  CLOSE_LABEL,
  COMPARE_SUBTITLE,
  compareTitle,
  PROMOTE_CONFIRM_TITLE,
  PROMOTING_LABEL,
  promoteConfirmMessage,
  promoteLabel,
  promoteSuccessMessage,
  SYSTEM_PROMPT_DIFF_LABEL,
} from "./constants";
import { matchVersionSnapshot, orderRuns, toAgentUpdatePatch, type AgentVersionSnapshot } from "./helpers";
import { s } from "./styles";

export interface CompareRunsModalProps {
  /** Exactly the two runs selected in `EvalOwnerDetail`'s recent-runs table
   *  (AC-33) — order doesn't matter, this component sorts them itself. */
  runs: [EvalRunRecord, EvalRunRecord];
  /** The owner's agent-version history (T13's `useOwnerAgentVersions`) —
   *  used to resolve each selected run's matching config snapshot. */
  versions: AgentVersionSnapshot[];
  onClose: () => void;
}

/**
 * CompareRunsModal (T14) — AC-34's compare view for two selected eval runs:
 * per-metric old -> new deltas (Recall/Precision/Citation/Cost) plus a
 * system-prompt diff built from the two runs' matched agent version
 * snapshots (`GET /agents/:id/versions`, already fetched by the parent — no
 * new endpoint). AC-41's "Promote" asks for confirmation, then issues the
 * existing `PUT /agents/:id` with the newer snapshot's config, followed by
 * `POST /agents/:id/skills` with its linked-skill set (two calls, not one —
 * `UpdateAgentBody` doesn't accept `skills`; see
 * `docs/plans/eval-pipeline.md`'s T14 notes) — a single combined
 * success/error state, not two independent toasts (mutation errors are
 * already surfaced once each by the global `MutationCache` error toast in
 * `lib/providers.tsx`; a combined success toast fires only once both calls
 * resolve).
 */
export function CompareRunsModal({ runs, versions, onClose }: CompareRunsModalProps) {
  const toast = useToast();
  const updateAgent = useUpdateAgent();
  const setSkills = useSetAgentSkills();

  const [confirmingPromote, setConfirmingPromote] = React.useState(false);
  const [promoting, setPromoting] = React.useState(false);

  const [older, newer] = orderRuns(runs);
  const oldSnapshot = matchVersionSnapshot(older.ran_at, versions);
  const newSnapshot = matchVersionSnapshot(newer.ran_at, versions);
  const hasBothSnapshots = oldSnapshot !== null && newSnapshot !== null;

  const handlePromote = async () => {
    if (!newSnapshot) return;
    setConfirmingPromote(false);
    setPromoting(true);
    try {
      // PUT before POST — Architecture Notes / T14 notes' two-call order.
      await updateAgent.mutateAsync({
        id: newSnapshot.agent_id,
        patch: toAgentUpdatePatch(newSnapshot.config),
      });
      await setSkills.mutateAsync({ agentId: newSnapshot.agent_id, skillIds: newSnapshot.config.skills });
      toast.success(promoteSuccessMessage(newSnapshot.version));
    } catch {
      // Already surfaced by the global mutation-error toast (`lib/providers.tsx`);
      // nothing else to do here.
    } finally {
      setPromoting(false);
    }
  };

  return (
    <>
      {confirmingPromote && newSnapshot && (
        <ConfirmDialog
          title={PROMOTE_CONFIRM_TITLE}
          message={promoteConfirmMessage(newSnapshot.version)}
          confirmLabel={promoteLabel(newSnapshot.version)}
          onCancel={() => setConfirmingPromote(false)}
          onConfirm={handlePromote}
        />
      )}
      <Modal
        width={1040}
        onClose={onClose}
        title={compareTitle(oldSnapshot?.version, newSnapshot?.version)}
        subtitle={COMPARE_SUBTITLE}
        footer={
          <div style={s.footer}>
            <Button kind="ghost" onClick={onClose}>
              {CLOSE_LABEL}
            </Button>
            <Button
              kind="primary"
              icon="GitBranch"
              loading={promoting}
              disabled={!newSnapshot || promoting}
              onClick={() => setConfirmingPromote(true)}
            >
              {promoting ? PROMOTING_LABEL : promoteLabel(newSnapshot?.version)}
            </Button>
          </div>
        }
      >
        <div style={s.body}>
          <CompareMetricsRow older={older} newer={newer} />
          <SectionLabel icon="FileText">{SYSTEM_PROMPT_DIFF_LABEL}</SectionLabel>
          <SystemPromptDiff
            oldPrompt={oldSnapshot?.config.system_prompt ?? ""}
            newPrompt={newSnapshot?.config.system_prompt ?? ""}
            oldVersion={oldSnapshot?.version}
            newVersion={newSnapshot?.version}
            hasBothSnapshots={hasBothSnapshots}
          />
        </div>
      </Modal>
    </>
  );
}
