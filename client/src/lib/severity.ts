import type { FindingRecord, Severity } from "@devdigest/shared";

/** Canonical severity display order, worst first. */
export const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Sort weight per severity (lower = shown first). */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

/** Tally live (non-dismissed) findings per severity. */
export function tallySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const f of findings) {
    if (!f.dismissed_at && f.severity in counts) counts[f.severity as Severity]++;
  }
  return counts;
}
