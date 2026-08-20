import type { BlastRadius } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from '../reviews/repository.js';
import type { BlastResult, ReverseImpactResult } from '../repo-intel/types.js';
import { assembleBlastRadius, deriveIndexStatus } from './assemble.js';
import { MAX_PRIOR_PRS } from './constants.js';

/**
 * Blast Radius — application service (`service.ts`, T5). Mirrors
 * `SmartDiffService` (`smart-diff/service.ts:44-58`): resolves the PR's
 * changed files via `container.reviewRepo`, coordinates the three
 * `container.repoIntel` reads, and hands them to the pure
 * `assembleBlastRadius` (T4). No caching, no persistence, no LLM (REQ-9) —
 * `blast/` only ever goes through the `repoIntel` facade and `reviewRepo` —
 * it never reaches into the repo-intel module's internal data-access layer
 * or the Drizzle client/schema directly.
 *
 * REQ-5 fix (architecture-reviewer audit, HIGH): `getIndexState` is awaited
 * FIRST, before deciding whether to call `getBlastRadius`/`getReverseImpact`
 * at all. `RepoIntelService.getBlastRadius`'s persistent-index path
 * (`tryPersistentBlast`) falls back to a live ripgrep/AST re-scan of the
 * cloned repo whenever the index isn't usable — a legitimate best-effort
 * feature of the facade in general (repo-intel/service.ts:212-305), but this
 * HTTP route must never trigger it: REQ-4's `degraded` index state exists
 * precisely so a request-time filesystem walk + regex re-parse is never
 * necessary. So whenever the index is unusable, the expensive facade calls
 * are skipped entirely and `assembleBlastRadius` is fed cheap empty/degraded
 * stand-ins instead — its own state-derivation (rule 5) still produces
 * `state: 'degraded'` from `index` alone, so the observable response is
 * unchanged, only the live-scan path is now never invoked.
 *
 * REQ-5 fix #2 (second architecture-reviewer audit pass, HIGH): the gate
 * above only checked index HEALTH, not whether repo-intel reading is even
 * enabled. `RepoIntelService.getBlastRadius` has its OWN separate guard
 * (`repo-intel/service.ts:224`: `if (this.container.config.repoIntelEnabled
 * && changedFiles.length > 0)`) — when the flag is off, that whole
 * persistent-path branch is skipped regardless of index health, and
 * execution falls through to the same live ripgrep/AST fallback REQ-5
 * forbids on the request path. Concretely: a repo indexed before
 * `REPO_INTEL_ENABLED` was flipped to `false` still has a healthy-looking
 * `repo_index_state` row, so the health-only gate said "proceed" — but
 * `getBlastRadius` itself then ignored that healthy index because the flag
 * is off, and ran the live scan anyway. `indexUsable` now ALSO requires
 * `container.config.repoIntelEnabled === true`; when the flag is off it's
 * treated exactly like an unusable index — same degraded stand-in path,
 * live scan never attempted. (`repo-intel/service.ts`'s own guard/fallback
 * is untouched — it may still be legitimate for other future callers.)
 *
 * Prior PRs (`docs/plans/blast-radius-prior-prs.md`, T4): "Prior PRs touching
 * these files" is plain reference data read via
 * `reviewRepo.getPriorPrsTouchingFiles` — it comes straight from
 * `pull_requests`/`pr_files`, is completely unaffected by index health, and
 * adds no LLM call. That read happens once, outside/independent of the
 * `indexUsable` branch below, so it still runs (and still returns real data)
 * even when the index is degraded or missing (REQ-5).
 */
export class BlastService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = container.reviewRepo;
  }

  /** `GET /pulls/:id/blast`. */
  async get(workspaceId: string, prId: string): Promise<BlastRadius> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);
    const paths = files.map((f) => f.path);

    // Prior PRs are reference data (REQ-5) — resolved here, before/independent
    // of the indexUsable branch below, so it is never skipped alongside the
    // degraded-index stand-ins and always reflects real DB data.
    const priorPrs = await this.repo.getPriorPrsTouchingFiles({
      workspaceId,
      repoId: pull.repoId,
      excludePrId: prId,
      paths,
      limit: MAX_PRIOR_PRS,
    });

    const index = await this.container.repoIntel.getIndexState(pull.repoId);
    const indexStatus = deriveIndexStatus(index);
    const indexUsable =
      this.container.config.repoIntelEnabled &&
      indexStatus !== 'missing' &&
      indexStatus !== 'degraded' &&
      indexStatus !== 'failed';

    const [blast, reverse]: [BlastResult, ReverseImpactResult] = indexUsable
      ? await Promise.all([
          this.container.repoIntel.getBlastRadius(pull.repoId, paths),
          this.container.repoIntel.getReverseImpact(pull.repoId, paths),
        ])
      : [degradedBlastStandIn(), emptyReverseImpactStandIn()];

    return assembleBlastRadius({ blast, index, reverse, changedFiles: paths, now: new Date(), priorPrs });
  }
}

/**
 * Cheap stand-in for the case the index is unusable. Matches what
 * `RepoIntelService.getBlastRadius`'s live ripgrep fallback always returns in
 * that situation (`repo-intel/service.ts:298-304`: `degraded: true, reason:
 * 'no_data'`, regardless of what it actually found) — so skipping the call
 * produces the identical `assembleBlastRadius` output without doing the scan.
 */
function degradedBlastStandIn(): BlastResult {
  return { changedSymbols: [], callers: [], impactedEndpoints: [], degraded: true, reason: 'no_data' };
}

/**
 * Cheap stand-in matching a reverse-impact walk that found nothing — the real
 * shape `getReverseImpact` returns when there's no `file_edges`/`file_facts`
 * data for the repo yet (`repo-intel/service.ts:775`).
 */
function emptyReverseImpactStandIn(): ReverseImpactResult {
  return { files: [], endpoints: [], crons: [], byFile: {}, originsByFile: {}, depthLimited: false };
}
