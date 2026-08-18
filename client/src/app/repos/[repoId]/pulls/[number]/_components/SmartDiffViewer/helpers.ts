import type {
  FindingRecord,
  PrFile,
  ReviewRecord,
  RunSummary,
  SmartDiffGroup,
} from "@devdigest/shared";

const SEVERITY_RANK: Record<FindingRecord["severity"], number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};

export type FindingsByLine = Map<number, FindingRecord[]>;

export interface SmartDiffFindingProjection {
  findingsByPath: Map<string, FindingsByLine>;
  findingCountByPath: Map<string, number>;
  latestReviews: ReviewRecord[];
}

/** path -> PrFile lookup, built once per render. Smart Diff's own payload
 *  carries no patch text (only role/line_findings), so the caller resolves
 *  each group's file path against this map to get the actual diff. A path
 *  present in a group but missing from `files` (stale/renamed) has no entry
 *  here — the caller skips it rather than rendering a patch-less card. */
export function buildFileMap(files: PrFile[]): Map<string, PrFile> {
  return new Map(files.map((file) => [file.path, file]));
}

/**
 * Select each agent's latest review using the same strict-newer rule as the
 * server's `latestPerAgent`. Null-agent rows remain independent because their
 * own review id participates in the grouping key.
 */
export function selectLatestReviewRecords(reviews: ReviewRecord[]): ReviewRecord[] {
  const latest = new Map<string, ReviewRecord>();

  for (const review of reviews) {
    if (review.kind !== "review") continue;
    const key = `${review.pr_id}:${review.agent_id ?? review.id}`;
    const current = latest.get(key);
    if (!current || timestampOf(review.created_at) > timestampOf(current.created_at)) {
      latest.set(key, review);
    }
  }

  return [...latest.values()];
}

/**
 * Join full finding records to the fixed SmartDiff contract. The endpoint's
 * `line_findings` ids remain authoritative, so stale review-query data can
 * never create an inline marker that the server excluded.
 */
export function projectSmartDiffFindings(
  groups: SmartDiffGroup[],
  reviews: ReviewRecord[],
): SmartDiffFindingProjection {
  const allowedIdsByPath = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const file of group.files) {
      allowedIdsByPath.set(file.path, new Set(file.line_findings.map((lineFinding) => lineFinding.id)));
    }
  }

  const latestReviews = selectLatestReviewRecords(reviews);
  const reviewCreatedAt = new Map(latestReviews.map((review) => [review.id, timestampOf(review.created_at)]));
  const findingsByPath = new Map<string, FindingsByLine>();

  for (const review of latestReviews) {
    for (const finding of review.findings) {
      if (finding.dismissed_at != null) continue;
      const allowedIds = allowedIdsByPath.get(finding.file);
      if (!allowedIds?.has(finding.id)) continue;

      let byLine = findingsByPath.get(finding.file);
      if (!byLine) {
        byLine = new Map();
        findingsByPath.set(finding.file, byLine);
      }
      const lineFindings = byLine.get(finding.start_line);
      if (lineFindings) lineFindings.push(finding);
      else byLine.set(finding.start_line, [finding]);
    }
  }

  const findingCountByPath = new Map<string, number>();
  for (const [path, byLine] of findingsByPath) {
    let count = 0;
    for (const findings of byLine.values()) {
      findings.sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          (reviewCreatedAt.get(b.review_id) ?? -Infinity) -
            (reviewCreatedAt.get(a.review_id) ?? -Infinity) ||
          a.id.localeCompare(b.id),
      );
      count += findings.length;
    }
    findingCountByPath.set(path, count);
  }

  return { findingsByPath, findingCountByPath, latestReviews };
}

/**
 * Token provenance is all-or-nothing: one missing/unfinished run suppresses
 * the status rather than presenting a partial total as authoritative.
 */
export function tokenTotalForLatestReviews(
  latestReviews: ReviewRecord[],
  runs: RunSummary[],
): number | null {
  if (latestReviews.length === 0) return null;
  const runsById = new Map(runs.map((run) => [run.run_id, run]));
  const countedRunIds = new Set<string>();
  let total = 0;

  for (const review of latestReviews) {
    if (!review.run_id) return null;
    const run = runsById.get(review.run_id);
    if (
      !run ||
      run.status !== "done" ||
      run.tokens_in == null ||
      run.tokens_out == null
    ) {
      return null;
    }
    if (!countedRunIds.has(run.run_id)) {
      countedRunIds.add(run.run_id);
      total += run.tokens_in + run.tokens_out;
    }
  }

  return total;
}

function timestampOf(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? -Infinity : timestamp;
}
