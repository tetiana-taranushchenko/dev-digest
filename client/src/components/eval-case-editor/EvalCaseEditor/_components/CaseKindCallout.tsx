"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import { evalCaseKindFromExpectedOutput } from "../helpers";
import { s } from "../styles";

/**
 * CaseKindCallout — sits to the right of the Name field and tells the user,
 * before they save, whether the case they're building is a positive
 * (`must_find`) or negative (`must_not_flag`) assertion. Derives the kind
 * live from the same `expectedOutputText` the JSON editor below is showing
 * (`evalCaseKindFromExpectedOutput`), so editing Expected output flips this
 * badge immediately — it never needs a separate "case type" field to get out
 * of sync with.
 */
export function CaseKindCallout({ expectedOutputText }: { expectedOutputText: string }) {
  const t = useTranslations("eval");
  const info = evalCaseKindFromExpectedOutput(expectedOutputText);
  const positive = info.kind === "must_find";

  const description = positive
    ? info.title && info.file && info.line != null
      ? t("caseEditor.caseKind.mustFindTitledAt", { title: info.title, file: info.file, line: info.line })
      : info.title
        ? t("caseEditor.caseKind.mustFindTitled", { title: info.title })
        : info.file && info.line != null
          ? t("caseEditor.caseKind.mustFindAt", { file: info.file, line: info.line })
          : t("caseEditor.caseKind.mustFindGeneric")
    : t("caseEditor.caseKind.mustNotFlag");

  return (
    <div style={{ ...s.caseKindCallout, ...(positive ? s.caseKindCalloutPositive : s.caseKindCalloutNegative) }}>
      <Badge color={positive ? "var(--accent-text)" : "var(--warn)"} bg={positive ? "var(--accent-bg)" : "var(--warn-bg)"}>
        {positive ? t("caseEditor.caseKind.positiveLabel") : t("caseEditor.caseKind.negativeLabel")}
      </Badge>
      <span style={s.caseKindCalloutDesc} title={description}>
        {description}
      </span>
    </div>
  );
}
