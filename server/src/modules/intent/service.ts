import type { PrIntentRecord, UnifiedDiff } from '@devdigest/shared';
import { classifyIntent, deriveConfidence } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository, PullRow, RepoRow, IntentRow } from '../reviews/repository.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { gatherIntentSignals } from './signals.js';
import type { PinoLike } from '../../platform/run-logger.js';

/**
 * IntentService — the "IntentService" box in the plan's §2 call sequence.
 *
 * This task (T7) wires it as a STANDALONE HTTP surface only
 * (`GET`/`POST /pulls/:id/intent`) — the shared-pre-work call site inside
 * `ReviewRunExecutor` (`ensureForPull` invoked once per Run Review batch,
 * before the per-agent loop) is T8, not yet implemented. `ensureForPull`
 * here is written so T8 can call it directly once it owns that wiring; for
 * now it loads its own diff via the same `loadDiff` helper `run-executor.ts`
 * uses (no double-load risk today since this is the only caller).
 *
 * Logging: `run-executor.ts` fans a `RunLogger` out over N queued runs
 * (`RunLogger` is bound to live `runId`s on the SSE bus) — there is no run
 * batch here, so binding one would have nothing to fan out to. This service
 * instead mirrors `run-executor.ts:109`'s plain `logger?.info(...)` pino
 * line; T8 can additionally wrap ITS call to `ensureForPull` in
 * `runLog.step('Deriving PR intent', …, { kind: 'tool' })` without changing
 * anything here.
 */
/**
 * Per-PR in-flight-derivation dedup, closing the TOCTOU race between the
 * cache-check and `derive()` in `ensureForPull` (see the comment at its
 * call site below for the full trace-through).
 *
 * This is deliberately MODULE-level, not an instance field on
 * `IntentService`. Both call sites (`routes.ts`, `run-executor.ts`)
 * construct a fresh `IntentService(this.container)` per request/batch — an
 * instance-level `Map` would only dedup concurrent `ensureForPull` calls
 * made through the exact same `IntentService` object, which never happens
 * in practice, so it would silently fail to close the race it exists for.
 * A module-level `Map` is shared by every `IntentService` instance created
 * within this Node process, so two concurrent requests for the same `prId`
 * — regardless of which instance/route/batch they came through — join the
 * same in-flight `derive()` call. Scoped to this file only (not exported),
 * so it can't leak into unrelated modules.
 *
 * This does NOT dedup across multiple server processes/replicas (e.g. a
 * horizontally-scaled deployment) — that would need a DB-level advisory
 * lock or similar, out of scope for this single-process dev/course project.
 */
const inFlightDerivations = new Map<string, Promise<PrIntentRecord>>();

export class IntentService {
  private repo: ReviewRepository;

  constructor(private container: Container) {
    this.repo = container.reviewRepo;
  }

  /** `GET /pulls/:id/intent` — 404s when no COMPLETE intent has been derived
   *  yet (T6's null-check contract: a row with `provider === null` — which
   *  happens atomically with `model`/`confidence_reason` also null — is
   *  treated as "no intent yet", identical to no row at all). */
  async get(workspaceId: string, prId: string): Promise<PrIntentRecord> {
    await this.requirePull(workspaceId, prId);
    const row = await this.repo.getIntent(prId);
    if (!row || !isCompleteRow(row)) {
      throw new NotFoundError('No intent has been derived for this PR yet');
    }
    return toRecord(row);
  }

  /** `POST /pulls/:id/intent` — force-recompute, always calling the LLM. */
  async classify(workspaceId: string, prId: string, logger?: PinoLike): Promise<PrIntentRecord> {
    return this.ensureForPull(workspaceId, prId, { force: true, logger });
  }

  /**
   * Cache-or-derive. `force: false` (the default) returns the persisted
   * intent as-is when a COMPLETE row already exists AND its stored
   * `head_sha` matches the PR's current head — zero LLM calls. Otherwise
   * (no row, an incomplete row, or the head moved since the cached row was
   * written) falls through to `derive()`, same path as no-existing-row.
   *
   * `opts.diff`: an already-loaded diff (e.g. `run-executor.ts` loads the
   * diff once per batch before calling this). When provided, `derive()` uses
   * it directly instead of loading its own copy — avoids a duplicate
   * diff load on a cache miss. Callers with no pre-loaded diff (e.g. the
   * `POST /pulls/:id/intent` route) omit it and `derive()` loads it itself,
   * unchanged from before.
   *
   * `opts.logger`: typed as the framework-free `PinoLike` (not
   * `FastifyBaseLogger`) so BOTH a real Fastify request logger (`routes.ts`'s
   * `req.log`, structurally compatible) AND `run-executor.ts`'s own minimal
   * `Logger` type (identical shape) can be passed — the latter has no
   * Fastify request in scope (it runs in a background batch, not a route
   * handler).
   */
  async ensureForPull(
    workspaceId: string,
    prId: string,
    opts: { force?: boolean; logger?: PinoLike; diff?: UnifiedDiff } = {},
  ): Promise<PrIntentRecord> {
    const { pull, repo } = await this.requirePull(workspaceId, prId);

    if (!opts.force) {
      const existing = await this.repo.getIntent(prId);
      if (existing && isCompleteRow(existing) && existing.headSha === pull.headSha) {
        opts.logger?.info({ prId }, 'intent: cache hit, 0 LLM calls');
        return toRecord(existing);
      }
    }

    // TOCTOU guard: the cache-check above (and `force`) can both let two
    // concurrent callers reach this point for the same `prId` before either
    // has persisted anything. Join an already-running derivation instead of
    // starting a second one. The `.get()` check and `.set()` below have no
    // `await` between them, so no other call can interleave in that window
    // — this is what actually closes the race (see the module-level `Map`
    // comment above for why it must be module-, not instance-, scoped).
    const inFlight = inFlightDerivations.get(prId);
    if (inFlight) {
      opts.logger?.info({ prId }, 'intent: joining in-flight derivation, 0 additional LLM calls');
      return inFlight;
    }

    const derivation = this.derive(workspaceId, pull, repo, opts.logger, opts.diff);
    inFlightDerivations.set(prId, derivation);
    // Clean up on both success and failure so a later legitimate
    // re-derivation (head_sha changed, or another force-recompute) isn't
    // permanently blocked by a resolved/rejected entry. `.catch()` here
    // only swallows the rejection on THIS secondary listener (created for
    // cleanup bookkeeping) so Node doesn't flag it as unhandled — the
    // original `derivation` promise returned below still rejects normally
    // for whoever awaits `ensureForPull`.
    derivation.finally(() => inFlightDerivations.delete(prId)).catch(() => {});
    return derivation;
  }

  /** Gather signals → classify (cheap model) → derive confidence → persist. */
  private async derive(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    logger?: PinoLike,
    preloadedDiff?: UnifiedDiff,
  ): Promise<PrIntentRecord> {
    const start = Date.now();
    logger?.info({ prId: pull.id }, 'intent: deriving PR intent');

    const diff = preloadedDiff ?? (await loadDiff(this.container, this.repo, workspaceId, pull, repo));
    const { promptInputs, confidenceSources, persistedSources } = await gatherIntentSignals(
      this.container,
      pull,
      repo,
      diff,
    );

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm(provider);

    const classified = await classifyIntent({
      llm,
      model,
      signals: promptInputs,
      sessionId: `${repo.owner}/${repo.name}#${pull.number}:intent`,
    });

    const { confidence, confidence_reason } = deriveConfidence(confidenceSources);
    const durationMs = Date.now() - start;
    const generatedAt = new Date().toISOString();

    // HIGH-finding closure: confidence / confidence_reason / provider / model
    // are ALL set together, in this ONE upsertIntent call — there is no
    // branch anywhere in this method that persists only some of them.
    await this.repo.upsertIntent(pull.id, {
      intent: classified.intent.intent,
      in_scope: classified.intent.in_scope,
      out_of_scope: classified.intent.out_of_scope,
      confidence,
      confidence_reason,
      sources: persistedSources,
      provider,
      model,
      generated_at: generatedAt,
      headSha: pull.headSha,
      tokensIn: classified.tokensIn,
      tokensOut: classified.tokensOut,
      costUsd: classified.costUsd,
      durationMs,
    });

    logger?.info(
      {
        prId: pull.id,
        provider,
        model,
        durationMs,
        tokensIn: classified.tokensIn,
        tokensOut: classified.tokensOut,
        costUsd: classified.costUsd,
        confidence,
        sources: persistedSources.filter((s) => s.fetched).map((s) => s.signal),
      },
      `intent: derived (confidence=${confidence})`,
    );

    return {
      pr_id: pull.id,
      intent: classified.intent.intent,
      in_scope: classified.intent.in_scope,
      out_of_scope: classified.intent.out_of_scope,
      confidence,
      confidence_reason,
      sources: persistedSources,
      provider,
      model,
      generated_at: generatedAt,
    };
  }

  private async requirePull(
    workspaceId: string,
    prId: string,
  ): Promise<{ pull: PullRow; repo: RepoRow }> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pull, repo };
  }
}

/** T6's null-check contract: complete iff provider/model/confidence_reason
 *  are ALL non-null (they are always written together — see `derive()`). */
function isCompleteRow(
  row: IntentRow,
): row is IntentRow & { provider: string; model: string; confidence_reason: string } {
  return row.provider != null && row.model != null && row.confidence_reason != null;
}

function toRecord(
  row: IntentRow & { provider: string; model: string; confidence_reason: string },
): PrIntentRecord {
  return {
    pr_id: row.pr_id,
    intent: row.intent,
    in_scope: row.in_scope,
    out_of_scope: row.out_of_scope,
    confidence: row.confidence,
    confidence_reason: row.confidence_reason,
    sources: row.sources,
    provider: row.provider,
    model: row.model,
    generated_at: row.generated_at,
  };
}
