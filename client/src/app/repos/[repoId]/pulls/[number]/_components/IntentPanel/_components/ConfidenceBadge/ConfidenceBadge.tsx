import { Badge } from "@devdigest/ui";
import type { IntentConfidence } from "@devdigest/shared";
import { CONFIDENCE_COLOR } from "../../constants";

/** Confidence tier badge (HIGH/MEDIUM/LOW). Color-coded but the label text
 *  always renders too — color alone never carries the meaning.
 *
 *  Wrapped in a `<span>` because `Badge` has no `title`/`aria-label`
 *  pass-through — the wrapper carries the tooltip and accessible name while
 *  `Badge` renders the actual markup/tokens. */
export function ConfidenceBadge({
  tier,
  label,
  reason,
  ariaLabel,
}: {
  tier: IntentConfidence;
  /** Already-translated tier label, e.g. "HIGH". */
  label: string;
  /** `confidence_reason` — shown as a tooltip. */
  reason: string;
  ariaLabel: string;
}) {
  const { color, bg } = CONFIDENCE_COLOR[tier];
  return (
    <span title={reason} aria-label={ariaLabel}>
      <Badge color={color} bg={bg} style={{ fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </Badge>
    </span>
  );
}
