"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, Textarea, Toggle, Checkbox, Button, Badge } from "@devdigest/ui";
import type { Skill, SkillType } from "@devdigest/shared";
import { useUpdateSkill } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { SKILL_TYPE_VALUES, UNTRUSTED_SOURCES } from "./constants";
import { s } from "./styles";

function slugify(name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  return slug || "skill";
}

/** Config tab — name/description/type/body + enabled toggle (with the
 *  untrusted-source vetting gate: an imported_url/community skill that is
 *  currently disabled cannot be flipped on without an explicit acknowledgement,
 *  which the server also enforces via `vetted: true` (422 without it). */
export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();

  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<SkillType>(skill.type);
  const [body, setBody] = React.useState(skill.body);
  const [enabled, setEnabled] = React.useState(skill.enabled);
  const [ack, setAck] = React.useState(false);

  // Reset local form when switching skills.
  React.useEffect(() => {
    setName(skill.name);
    setDescription(skill.description);
    setType(skill.type);
    setBody(skill.body);
    setEnabled(skill.enabled);
    setAck(false);
  }, [skill.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isUntrusted = (UNTRUSTED_SOURCES as readonly string[]).includes(skill.source);
  // Only relevant while the skill is currently disabled — once enabled, no gate.
  const needsVetting = isUntrusted && !skill.enabled;
  const bodyChanged = body !== skill.body;
  const tokenEstimate = Math.ceil(body.length / 4);
  const filename = `${slugify(name)}.md`;

  const save = () =>
    update.mutate(
      {
        id: skill.id,
        patch: {
          name,
          description,
          type,
          body,
          enabled,
          ...(needsVetting && enabled ? { vetted: ack } : {}),
        },
      },
      { onSuccess: (data) => toast.success(t("config.savedToast", { version: data.version })) },
    );

  const saveDisabled = update.isPending || (needsVetting && enabled && !ack);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("preview.enabled")}
          <Toggle on={enabled} onChange={setEnabled} size={16} />
        </label>
      </div>

      {needsVetting && enabled && (
        <div style={s.vettingBox}>
          <div style={s.vettingText}>{t("preview.untrustedNotice")}</div>
          <label style={s.vettingAck}>
            <Checkbox checked={ack} onChange={setAck} />
            {t("config.vettingAck")}
          </label>
        </div>
      )}

      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={setName} />
      </FormField>
      <FormField label={t("config.description")} hint={t("config.descriptionHint")}>
        <TextInput value={description} onChange={setDescription} />
      </FormField>
      <FormField label={t("config.type")}>
        <SelectInput
          value={type}
          onChange={(v) => setType(v as SkillType)}
          options={SKILL_TYPE_VALUES.map((v) => ({ value: v, label: t(`listItem.type.${v}`) }))}
        />
      </FormField>

      <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")}>
        <div style={s.bodyHeader}>
          <span style={s.bodyFilename}>{filename}</span>
          {bodyChanged && <Badge color="var(--warn)">{t("config.unsaved")}</Badge>}
          <span style={s.bodyTokens}>{t("config.tokenEstimate", { count: tokenEstimate })}</span>
        </div>
        <Textarea value={body} onChange={setBody} rows={20} mono />
      </FormField>

      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={saveDisabled}>
          {update.isPending ? t("config.saving") : t("preview.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>{t("config.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}
