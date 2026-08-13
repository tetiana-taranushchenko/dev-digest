"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Button } from "@devdigest/ui";
import type { SkillType } from "@devdigest/shared";
import { useCreateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { ApiError } from "../../../../../../lib/api";

const SKILL_TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Create tab — write a skill's body directly (no import step). Manually-
 *  authored skills are trusted at creation (source: 'manual', enabled
 *  immediately) — the untrusted/needs-vetting gate only applies to
 *  file/URL/community imports. */
export function CreateTab({ onImported }: { onImported: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const create = useCreateSkill();

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<SkillType>("rubric");
  const [body, setBody] = React.useState("");

  const submit = () => {
    create.mutate(
      { name, description, type, source: "manual", body },
      {
        onSuccess: (data) => {
          toast.success(t("create.success", { name: data.name }));
          onImported();
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : t("drawer.importFailed")),
      },
    );
  };

  const canSubmit = name.trim().length > 0 && body.trim().length > 0 && !create.isPending;

  return (
    <div>
      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={setName} placeholder={t("create.namePlaceholder")} />
      </FormField>
      <FormField label={t("config.description")}>
        <TextInput value={description} onChange={setDescription} placeholder={t("create.descriptionPlaceholder")} />
      </FormField>
      <FormField label={t("config.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>
      <FormField label={t("create.bodyLabel")}>
        <Textarea value={body} onChange={setBody} rows={12} mono placeholder={t("create.bodyPlaceholder")} />
      </FormField>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Button kind="primary" icon="Plus" onClick={submit} disabled={!canSubmit}>
          {create.isPending ? t("create.submitting") : t("create.submit")}
        </Button>
      </div>
    </div>
  );
}
