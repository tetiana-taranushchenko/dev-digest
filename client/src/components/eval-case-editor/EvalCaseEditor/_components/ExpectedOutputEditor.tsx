"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Textarea } from "@devdigest/ui";
import { s } from "../styles";

/**
 * ExpectedOutputEditor — the JSON editor for `expected_output` with an
 * inline valid/invalid JSON badge that blocks Save when invalid (AC-25).
 *
 * Builds its own label row (not `FormField` — no `style` hook there) so its
 * trailing margin is an exact, direct value (`s.expectedOutputField`)
 * instead of `FormField`'s fixed 20px: `FormField` is a flex item's child
 * here, and flex items don't collapse margins with their descendants, so a
 * wrapper's negative margin can't cancel it out — it just adds a same-size
 * blank gap trapped inside the wrapper instead of removing it.
 */
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
    <div style={s.expectedOutputField}>
      <div style={s.expectedOutputLabelRow}>
        <div style={s.expectedOutputLabel}>{t("caseEditor.expectedOutput")}</div>
        <Badge
          color={valid ? "var(--ok)" : "var(--crit)"}
          bg={valid ? "var(--ok-bg)" : "var(--crit-bg)"}
          icon={valid ? "Check" : "AlertTriangle"}
          style={s.expectedOutputBadge}
        >
          {valid ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
        </Badge>
      </div>
      <Textarea value={value} onChange={onChange} rows={9} mono />
      {!valid && (
        <div role="alert" style={s.invalidNote}>
          {t("caseEditor.invalidJson")}
        </div>
      )}
    </div>
  );
}
