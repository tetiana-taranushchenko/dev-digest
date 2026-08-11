"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Button } from "@devdigest/ui";
import type { SkillType, SkillSource } from "@devdigest/shared";
import { useImportSkillFile, useCreateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { ApiError } from "../../../../../../lib/api";
import { s } from "./styles";

const SKILL_TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** File tab — a single continuous form (matches the reference design exactly:
 *  no Description field here). Choosing a file extracts its core (markdown
 *  text only; archive contents are never executed) and fills Skill name (if
 *  blank) + Skill body inline, still editable before the explicit "Import
 *  skill" click — the description the extractor derives is kept internally
 *  and sent on submit even though there's no visible field for it. */
export function FileTab({ onImported }: { onImported: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const importFile = useImportSkillFile();
  const create = useCreateSkill();

  const [fileName, setFileName] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("rubric");
  const [source, setSource] = React.useState<SkillSource>("imported_url");
  const [body, setBody] = React.useState("");

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    importFile.mutate(file, {
      onSuccess: (data) => {
        setName((prev) => prev || data.name);
        setDescription(data.description);
        setType(data.type);
        setSource(data.source);
        setBody(data.body);
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t("drawer.importFailed")),
    });
  };

  const submit = () => {
    create.mutate(
      { name: name.trim() || "Imported skill", description, type, source, body },
      {
        onSuccess: (data) => {
          toast.success(t("file.success", { name: data.name }));
          onImported();
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("drawer.importFailed")),
      },
    );
  };

  const busy = importFile.isPending || create.isPending;
  const canSubmit = body.trim().length > 0 && !busy;

  return (
    <div>
      <FormField label={t("file.nameLabel")} hint={t("file.nameHint")}>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("config.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>
      <FormField label={t("file.fileLabel")}>
        <div style={s.fileRow}>
          <label style={s.fileButton}>
            {t("file.chooseFile")}
            <input type="file" accept=".md,.markdown,.txt,.zip" onChange={onFile} style={s.fileInputHidden} />
          </label>
          <span style={s.fileName}>{fileName ?? t("file.noFileChosen")}</span>
        </div>
      </FormField>
      <FormField label={t("file.bodyLabel")} hint={t("file.bodyHint")}>
        <Textarea value={body} onChange={setBody} rows={10} mono />
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" onClick={submit} disabled={!canSubmit}>
          {busy ? t("file.importing") : t("file.import")}
        </Button>
      </div>
    </div>
  );
}
