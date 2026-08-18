import type { IntentSource } from "@devdigest/shared";

/** One human-readable fragment for the sources line, e.g. "PR title" or
 *  "external link (not fetched)". `signalLabel` / `notFetchedLabel` are
 *  already-translated strings (i18n stays in the component). */
export function describeSource(
  source: IntentSource,
  signalLabel: string,
  notFetchedLabel: string,
): string {
  return source.fetched ? signalLabel : `${signalLabel} (${notFetchedLabel})`;
}
