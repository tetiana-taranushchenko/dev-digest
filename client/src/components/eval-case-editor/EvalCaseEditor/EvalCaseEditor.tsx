"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Modal, SelectInput, TextInput, Toggle } from "@devdigest/ui";
import type { EvalCase, EvalCaseInput, EvalOwnerKind, EvalRun } from "@devdigest/shared";
import { useCreateEvalCase, useEvalCase, useRunEvalCase, useUpdateEvalCase } from "../../../lib/hooks/eval";
import { useAgents } from "../../../lib/hooks/agents";
import { useSkills } from "../../../lib/hooks/skills";
import { InputTabs } from "./_components/InputTabs";
import { ExpectedOutputEditor } from "./_components/ExpectedOutputEditor";
import { ActualOutputViewer } from "./_components/ActualOutputViewer";
import { RunOnSaveResult } from "./_components/RunOnSaveResult";
import {
  buildInputMeta,
  isOwnerMissing,
  isValidJson,
  parseInputMeta,
  parseJsonLenient,
  stringifyJson,
} from "./helpers";
import type { InputTabKey } from "./constants";
import { s } from "./styles";

export interface EvalCaseEditorProps {
  /** Pre-fills a brand-new case (e.g. "Turn into eval case", AC-27). Ignored
   *  once `caseId` is set — editing an existing case always wins. */
  seed?: EvalCaseInput;
  /** Editing an existing case — loaded via `useEvalCase`. */
  caseId?: string;
  onClose: () => void;
}

/**
 * EvalCaseEditor — the shared create/edit modal for eval cases (T9). Opens
 * from "New eval case" (optionally pre-filled with a `seed`) or from a
 * case's edit control (`caseId`). Exposes Name, an Input section with
 * Diff/Files/PR meta views (AC-24), an Expected output JSON editor with
 * inline validity that blocks Save (AC-25), a "Run on save" toggle whose
 * outcome renders inline after a successful save (AC-26), and an owner
 * picker that blocks Save until an owner is chosen when none is resolvable
 * (AC-30). `Save` persists but does not close the editor — the run outcome
 * (or the just-saved state) stays visible until the user closes it.
 */
export function EvalCaseEditor({ seed, caseId, onClose }: EvalCaseEditorProps) {
  const t = useTranslations("eval");
  const tCommon = useTranslations("common");

  const [resolvedCaseId, setResolvedCaseId] = React.useState<string | undefined>(caseId);
  const { data: loadedCase } = useEvalCase(resolvedCaseId);

  const [name, setName] = React.useState(seed?.name ?? "");
  const [ownerKind, setOwnerKind] = React.useState<EvalOwnerKind>(seed?.owner_kind ?? "agent");
  const [ownerId, setOwnerId] = React.useState(seed?.owner_id ?? "");
  const [inputDiff, setInputDiff] = React.useState(seed?.input_diff ?? "");
  const [inputFilesText, setInputFilesText] = React.useState(stringifyJson(seed?.input_files ?? null));
  const seedMeta = parseInputMeta(seed?.input_meta ?? null);
  const [metaTitle, setMetaTitle] = React.useState(seedMeta.title);
  const [metaBody, setMetaBody] = React.useState(seedMeta.body);
  const [metaPreview, setMetaPreview] = React.useState(false);
  const [expectedOutputText, setExpectedOutputText] = React.useState(
    stringifyJson(seed?.expected_output ?? []),
  );
  const [notes, setNotes] = React.useState(seed?.notes ?? "");
  const [activeTab, setActiveTab] = React.useState<InputTabKey>("diff");
  const [runOnSaveOn, setRunOnSaveOn] = React.useState(false);
  const [lastRun, setLastRun] = React.useState<EvalRun | null>(null);
  const [justSaved, setJustSaved] = React.useState(false);
  const justSavedTimeout = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  // Clears itself so a later save (or unmount) doesn't leave a stale timer
  // flipping `justSaved` back off after the editor's moved on.
  React.useEffect(() => () => clearTimeout(justSavedTimeout.current), []);

  // Sync local form state once an existing case loads (edit flow) — mirrors
  // AgentEditor's ConfigTab reset-on-identity-change pattern
  // (`_components/ConfigTab/ConfigTab.tsx:29`).
  React.useEffect(() => {
    if (!loadedCase) return;
    setName(loadedCase.name);
    setOwnerKind(loadedCase.owner_kind);
    setOwnerId(loadedCase.owner_id);
    setInputDiff(loadedCase.input_diff);
    setInputFilesText(stringifyJson(loadedCase.input_files));
    const meta = parseInputMeta(loadedCase.input_meta);
    setMetaTitle(meta.title);
    setMetaBody(meta.body);
    setExpectedOutputText(stringifyJson(loadedCase.expected_output));
    setNotes(loadedCase.notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedCase?.id]);

  const { data: agents } = useAgents();
  const { data: skills } = useSkills();
  const ownerOptions = ownerKind === "agent" ? (agents ?? []) : (skills ?? []);
  const ownerMissing = isOwnerMissing(ownerId);
  const expectedValid = isValidJson(expectedOutputText);

  const createCase = useCreateEvalCase();
  const updateCase = useUpdateEvalCase();
  const runCase = useRunEvalCase();
  const saving = createCase.isPending || updateCase.isPending;

  const save = async () => {
    if (!expectedValid || ownerMissing) return;
    const input: EvalCaseInput = {
      owner_kind: ownerKind,
      owner_id: ownerId,
      name,
      input_diff: inputDiff,
      input_files: parseJsonLenient(inputFilesText),
      input_meta: buildInputMeta(metaTitle, metaBody),
      expected_output: JSON.parse(expectedOutputText),
      notes: notes || null,
    };
    const saved: EvalCase = resolvedCaseId
      ? await updateCase.mutateAsync({ id: resolvedCaseId, input })
      : await createCase.mutateAsync(input);
    setResolvedCaseId(saved.id);
    if (runOnSaveOn) {
      const result = await runCase.mutateAsync(saved.id);
      setLastRun(result.result);
    }
    setJustSaved(true);
    clearTimeout(justSavedTimeout.current);
    justSavedTimeout.current = setTimeout(() => setJustSaved(false), 2000);
  };

  const runNow = async () => {
    if (!resolvedCaseId) return;
    const result = await runCase.mutateAsync(resolvedCaseId);
    setLastRun(result.result);
  };

  return (
    <Modal
      title={resolvedCaseId ? t("caseEditor.caseTitle", { name: loadedCase?.name ?? name }) : t("caseEditor.newCase")}
      onClose={onClose}
      width={1200}
      footer={
        <div style={s.footer}>
          <label style={s.runOnSaveLabel}>
            <Toggle on={runOnSaveOn} onChange={setRunOnSaveOn} size={16} />
            {t("caseEditor.runOnSave")}
          </label>
          <div style={s.footerActions}>
            <Button kind="secondary" onClick={onClose}>
              {tCommon("actions.cancel")}
            </Button>
            <Button
              kind="secondary"
              icon="Play"
              loading={runCase.isPending}
              onClick={runNow}
              disabled={!resolvedCaseId || runCase.isPending || saving}
            >
              {runCase.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
            </Button>
            <Button
              kind="primary"
              icon="Check"
              loading={saving}
              style={justSaved ? s.saveSuccess : undefined}
              onClick={save}
              disabled={!expectedValid || ownerMissing || saving || runCase.isPending}
            >
              {saving ? t("caseEditor.saving") : justSaved ? t("caseEditor.saved") : t("caseEditor.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.body}>
        <div style={s.nameField}>
          <div style={s.nameFieldLabel}>
            {t("caseEditor.nameLabel")}
            <span style={s.requiredMark}>*</span>
          </div>
          <TextInput value={name} onChange={setName} placeholder={t("caseEditor.namePlaceholder")} />
        </div>

        {ownerMissing && (
          <FormField label={t("caseEditor.owner.label")}>
            <div style={s.ownerRow}>
              <SelectInput
                value={ownerKind}
                onChange={(v) => {
                  setOwnerKind(v as EvalOwnerKind);
                  setOwnerId("");
                }}
                options={[
                  { value: "agent", label: t("caseEditor.owner.kindAgent") },
                  { value: "skill", label: t("caseEditor.owner.kindSkill") },
                ]}
              />
              <SelectInput
                value={ownerId}
                onChange={setOwnerId}
                options={[
                  { value: "", label: t("caseEditor.owner.selectPlaceholder") },
                  ...ownerOptions.map((o) => ({ value: o.id, label: o.name })),
                ]}
              />
            </div>
            <div role="alert" style={s.ownerAlert}>
              {t("caseEditor.ownerRequired")}
            </div>
          </FormField>
        )}

        <div style={s.columns}>
          <FormField label={t("caseEditor.inputLabel")}>
            <InputTabs
              activeTab={activeTab}
              onTabChange={setActiveTab}
              diff={inputDiff}
              onDiffChange={setInputDiff}
              filesText={inputFilesText}
              onFilesChange={setInputFilesText}
              metaTitle={metaTitle}
              onMetaTitleChange={setMetaTitle}
              metaBody={metaBody}
              onMetaBodyChange={setMetaBody}
              metaPreview={metaPreview}
              onMetaPreviewToggle={() => setMetaPreview((v) => !v)}
            />
          </FormField>

          <div style={s.rightColumn}>
            <ExpectedOutputEditor value={expectedOutputText} onChange={setExpectedOutputText} valid={expectedValid} />
            <ActualOutputViewer result={lastRun} />
          </div>
        </div>

        <RunOnSaveResult result={lastRun} />
      </div>
    </Modal>
  );
}
