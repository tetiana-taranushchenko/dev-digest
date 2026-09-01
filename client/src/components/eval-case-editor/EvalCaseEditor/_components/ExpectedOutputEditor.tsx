"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, FormField, Textarea } from "@devdigest/ui";
import { s } from "../styles";

/** ExpectedOutputEditor — the JSON editor for `expected_output` with an
 *  inline valid/invalid JSON badge that blocks Save when invalid (AC-25). */
export function ExpectedOutputEditor({
  value,
  onChange,
  valid,
}: {
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
}) {
  const t = useTranslations("eval");
  return (
    <FormField
      label={t("caseEditor.expectedOutput")}
      right={
        <Badge
          color={valid ? "var(--ok)" : "var(--crit)"}
          bg={valid ? "var(--ok-bg)" : "var(--crit-bg)"}
          icon={valid ? "Check" : "AlertTriangle"}
        >
          {valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
        </Badge>
      }
    >
      <Textarea value={value} onChange={onChange} rows={16} mono />
      {!valid && (
        <div role="alert" style={s.invalidNote}>
          {t("caseEditor.invalidJson")}
        </div>
      )}
    </FormField>
  );
}
