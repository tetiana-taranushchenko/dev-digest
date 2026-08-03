/** Compact USD cost display (e.g. "$0.0013", "$0.014"). Null/undefined
 *  (unpriced model, failed run, pre-cost-tracking data) renders as "—", never
 *  "$0.00" — a missing value is not the same as a free run. */
export function formatCost(costUsd: number | null | undefined): string {
  if (costUsd == null) return "—";
  return costUsd < 0.01 ? `$${costUsd.toFixed(4)}` : `$${costUsd.toFixed(3)}`;
}

/** Total token count (in + out), thousands-separated (e.g. "9,119 tok"). */
export function formatTokenCount(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  if (tokensIn == null && tokensOut == null) return "—";
  return `${((tokensIn ?? 0) + (tokensOut ?? 0)).toLocaleString()} tok`;
}
