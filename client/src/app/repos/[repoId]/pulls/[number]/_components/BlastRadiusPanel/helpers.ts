import type { BlastCaller, BlastRadius, PrFile } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { buildDiffLineRoute } from "../DiffTab/helpers";
import { parsePatch } from "@/components/diff-viewer/helpers";

/** Where a caller row's `file:line` should navigate. In-app when the caller's
 *  file is part of this PR's diff AND the target line is actually covered by
 *  a rendered hunk in that file's patch (REQ-7) — a file can be in the diff
 *  while a given line sits outside every hunk, in which case there's no
 *  `data-diff-line` element to scroll to and we must fall back like the
 *  "file not in diff" case. Otherwise the GitHub blob at that line — `url` is
 *  `null` only when we lack enough context (repo/sha) to build the GitHub
 *  link, in which case the row renders as plain text. */
export type CallerDestination =
  | { kind: "in-app"; route: string }
  | { kind: "external"; url: string | null };

/** True when `line` is present as a new-side line in `file`'s parsed patch,
 *  i.e. it's actually rendered in some hunk and has a `data-diff-line`
 *  element to scroll to. */
function isLineRenderedInDiff(file: PrFile | undefined, line: number): boolean {
  if (!file) return false;
  return parsePatch(file.patch).some((parsedLine) => parsedLine.newNo === line);
}

export function resolveCallerDestination(params: {
  caller: BlastCaller;
  /** The PR's changed files (`PrDetail.files`), used both to check whether
   *  the caller's file is part of the diff and, if so, whether its patch
   *  actually covers the caller's line. */
  files: PrFile[];
  repoId: string;
  prNumber: number;
  repoFullName?: string | null;
  headSha?: string | null;
}): CallerDestination {
  const { caller, files, repoId, prNumber, repoFullName, headSha } = params;

  const matchedFile = files.find((f) => f.path === caller.file);

  if (isLineRenderedInDiff(matchedFile, caller.line)) {
    return { kind: "in-app", route: buildDiffLineRoute(repoId, prNumber, caller.file, caller.line) };
  }

  return {
    kind: "external",
    url: repoFullName && headSha ? githubBlobUrl(repoFullName, headSha, caller.file, caller.line) : null,
  };
}

/** Machine `reason` codes the server may emit for `partial`/`degraded`
 *  states (T4's `reason_text` map, mirrored here only to know which ones
 *  have a translated `reason.<code>` key). Anything outside this set falls
 *  back to the server's `reason_text` verbatim. */
const KNOWN_REASON_CODES = new Set([
  "index_partial",
  "caller_cap",
  "depth_cap",
  "flag_off",
  "index_failed",
  "repo_too_large",
  "no_data",
]);

/** The i18n key to use for a `partial`/`degraded` reason, or `null` when the
 *  reason code is unrecognized — the caller should fall back to `reason_text`. */
export function reasonMessageKey(reason: string | null | undefined): string | null {
  return reason && KNOWN_REASON_CODES.has(reason) ? `reason.${reason}` : null;
}

export interface BlastStats {
  symbols: number;
  callers: number;
  endpoints: number;
  crons: number;
}

/** Header stats row counts. `callers` sums the true pre-cap `caller_count`
 *  (not `callers.length`, which may be capped at `MAX_CALLERS_PER_SYMBOL`).
 *  `endpoints`/`crons` dedupe across every `downstream` entry — the same
 *  endpoint/cron can legitimately appear under multiple changed symbols, and
 *  the header should report a real total, not a sum-with-duplicates. */
export function computeBlastStats(data: Pick<BlastRadius, "changed_symbols" | "downstream">): BlastStats {
  const endpoints = new Set<string>();
  const crons = new Set<string>();
  let callers = 0;

  for (const impact of data.downstream) {
    callers += impact.caller_count;
    for (const endpoint of impact.endpoints_affected) endpoints.add(endpoint);
    for (const cron of impact.crons_affected) crons.add(cron);
  }

  return {
    symbols: data.changed_symbols.length,
    callers,
    endpoints: endpoints.size,
    crons: crons.size,
  };
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

/**
 * Compact elapsed-time label for a prior-PR row ("11d ago", "2mo ago").
 * Deliberately NOT `pulls/helpers.ts:relativeTime` — that one is the PR-list
 * UPDATED column's formatter, has no month/year bucket and no "ago" suffix,
 * and changing it would change that column. `now` is injectable so the unit
 * test is deterministic.
 */
export function formatPriorPrAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "—";

  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";

  // Future timestamps (clock skew) clamp at 0 elapsed rather than going negative.
  const elapsedMs = Math.max(0, now - then);

  if (elapsedMs < MINUTE_MS) return "now";
  if (elapsedMs < 60 * MINUTE_MS) return `${Math.floor(elapsedMs / MINUTE_MS)}m ago`;
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)}h ago`;
  if (elapsedMs < MONTH_MS) return `${Math.floor(elapsedMs / DAY_MS)}d ago`;
  if (elapsedMs < YEAR_MS) return `${Math.floor(elapsedMs / MONTH_MS)}mo ago`;
  return `${Math.floor(elapsedMs / YEAR_MS)}y ago`;
}
