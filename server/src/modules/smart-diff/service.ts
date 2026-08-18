import type { RunSummary, Severity, SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository, ReviewRow } from '../reviews/repository.js';
import { latestPerAgent } from '../pulls/status.js';
import { assembleSmartDiff, type SmartDiffFindingInput } from './assemble.js';

/**
 * Sum of input+output tokens across `latestReviews`' completed runs.
 * All-or-nothing (mirrors the client's former `tokenTotalForLatestReviews`,
 * now computed here instead): any review with no run, or a run that isn't
 * `done` with known token counts, suppresses the whole total rather than
 * showing a partial number as authoritative.
 */
function computeReviewTokens(latestReviews: ReviewRow[], runs: RunSummary[]): number | null {
  if (latestReviews.length === 0) return null;
  const runsById = new Map(runs.map((run) => [run.run_id, run]));
  const countedRunIds = new Set<string>();
  let total = 0;

  for (const review of latestReviews) {
    if (!review.runId) return null;
    const run = runsById.get(review.runId);
    if (!run || run.status !== 'done' || run.tokens_in == null || run.tokens_out == null) return null;
    if (!countedRunIds.has(run.run_id)) {
      countedRunIds.add(run.run_id);
      total += run.tokens_in + run.tokens_out;
    }
  }

  return total;
}

/**
 * Smart Diff — application service (`service.ts`, T4). Mirrors
 * `IntentService` (`intent/service.ts:53-58`): holds `container.reviewRepo`
 * and coordinates two already-persisted sources (`pr_files` + each agent's
 * latest `kind: 'review'` findings) into the `SmartDiff` contract shape via
 * the pure `assembleSmartDiff` (T3). No caching, no persistence, no LLM
 * (REQ-6) — the whole computation is sub-millisecond CPU work over rows the
 * DB already has.
 */
export class SmartDiffService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = container.reviewRepo;
  }

  /** `GET /pulls/:id/smart-diff`. */
  async get(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);

    const reviewRows = await this.repo.reviewsForPull(prId);
    const reviewsOnly = reviewRows.filter(({ review }) => review.kind === 'review');
    // Scope to each agent's LATEST 'review' row (REQ-5) — same rule the PR
    // list already applies (`pulls/service.ts:126-193`), so badge counts here
    // can't disagree with what the PR list shows.
    const latestIds = latestPerAgent(reviewsOnly.map(({ review }) => review));
    const latestReviews = reviewsOnly.filter(({ review }) => latestIds.has(review.id)).map(({ review }) => review);

    const runs = await this.repo.listRunsForPull(workspaceId, prId);
    const reviewTokens = computeReviewTokens(latestReviews, runs);

    const findingsByPath = new Map<string, SmartDiffFindingInput[]>();
    for (const { review, findings } of reviewsOnly) {
      if (!latestIds.has(review.id)) continue;
      for (const finding of findings) {
        if (finding.dismissedAt != null) continue;
        const entry: SmartDiffFindingInput = {
          id: finding.id,
          line: finding.startLine,
          severity: finding.severity as Severity,
        };
        const list = findingsByPath.get(finding.file);
        if (list) list.push(entry);
        else findingsByPath.set(finding.file, [entry]);
      }
    }

    return assembleSmartDiff(files, findingsByPath, reviewTokens);
  }
}
