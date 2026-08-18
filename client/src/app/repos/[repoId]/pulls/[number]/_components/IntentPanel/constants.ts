import type { IntentConfidence } from "@devdigest/shared";

/** Confidence tier → badge color tokens. Label text is always shown alongside
 *  the color (WCAG AA: never color alone). */
export const CONFIDENCE_COLOR: Record<IntentConfidence, { color: string; bg: string }> = {
  high: { color: "var(--ok)", bg: "var(--ok-bg)" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)" },
  low: { color: "var(--crit)", bg: "var(--crit-bg)" },
};
