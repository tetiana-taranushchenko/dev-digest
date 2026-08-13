"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, Button } from "@devdigest/ui";
import { useImportSkillUrl, useCreateSkill } from "../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../lib/toast";
import { ApiError } from "../../../../../../lib/api";
import { s } from "./styles";

/** URL tab — matches the reference design exactly: just a URL field, an
 *  optional Skill name override, and one "Import from URL" button. Under the
 *  hood this still does a server-side fetch (SSRF-guarded, https-only,
 *  private-IP-blocked) + extraction + create in one chained action — the
 *  single click IS the confirmation; the created skill still lands disabled
 *  + needs-vetting (source: imported_url) like every other untrusted import,
 *  so nothing about the safety model is weakened by dropping the separate
 *  preview step for this tab specifically. */
export function UrlTab({ onImported }: { onImported: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const importUrl = useImportSkillUrl();
  const create = useCreateSkill();
  const [url, setUrl] = React.useState("");
  const [name, setName] = React.useState("");

  const submit = () => {
    if (!url.trim()) return;
    importUrl.mutate(url.trim(), {
      onSuccess: (preview) => {
        create.mutate(
          {
            name: name.trim() || preview.name,
            description: preview.description,
            type: preview.type,
            source: preview.source,
            body: preview.body,
          },
          {
            onSuccess: (data) => {
              toast.success(t("url.success", { name: data.name }));
              onImported();
            },
            onError: (err) => toast.error(err instanceof ApiError ? err.message : t("drawer.importFailed")),
          },
        );
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t("drawer.importFailed")),
    });
  };

  const busy = importUrl.isPending || create.isPending;

  return (
    <div>
      <FormField label={t("url.label")}>
        <TextInput value={url} onChange={setUrl} placeholder={t("url.placeholder")} />
      </FormField>
      <FormField label={t("url.nameLabel")}>
        <TextInput value={name} onChange={setName} placeholder={t("url.namePlaceholder")} />
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" onClick={submit} disabled={!url.trim() || busy}>
          {busy ? t("url.fetching") : t("url.import")}
        </Button>
      </div>
    </div>
  );
}
