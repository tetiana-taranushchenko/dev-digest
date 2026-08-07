import type { FindingRecord, Severity } from "@devdigest/shared";
import { SEVERITY_RANK } from "@/lib/severity";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";

/** Optionally drop low-confidence and/or non-matching-severity findings, then sort by severity. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severityFilter: Severity | null = null,
): FindingRecord[] {
  let shown = findings;
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  if (severityFilter) shown = shown.filter((f) => f.severity === severityFilter);
  return [...shown].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9),
  );
}
