import type { Severity } from "@devdigest/shared";

/** Canonical severity display order, worst first. */
export const SEVERITY_ORDER: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION"];

/** Sort weight per severity (lower = shown first). */
export const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};
