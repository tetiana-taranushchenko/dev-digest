import type { SmartDiff } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from '../reviews/repository.js';
import { latestPerAgent } from '../pulls/status.js';
import { assembleSmartDiff } from './assemble.js';

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

    const findingLinesByPath = new Map<string, number[]>();
    for (const { review, findings } of reviewsOnly) {
      if (!latestIds.has(review.id)) continue;
      for (const finding of findings) {
        if (finding.dismissedAt != null) continue;
        const lines = findingLinesByPath.get(finding.file);
        if (lines) lines.push(finding.startLine);
        else findingLinesByPath.set(finding.file, [finding.startLine]);
      }
    }

    return assembleSmartDiff(files, findingLinesByPath);
  }
}
