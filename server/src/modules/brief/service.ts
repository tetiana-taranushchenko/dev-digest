import type { Brief, BriefResult } from '@devdigest/shared';
import { assembleBriefPrompt, generateBrief, groundBriefCitations } from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import { ConfigError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { PinoLike } from '../../platform/run-logger.js';
import type { PullRow, RepoRow } from '../../db/rows.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { computeBriefStateKey } from './state-key.js';
import { gatherBriefSignals } from './signals.js';
import { trimToBudget } from './budget.js';
import { BriefRepository, type BriefRow } from './repository.js';

/**
 * brief/service.ts — Application ring (`docs/plans/pr-brief.md`, T6).
 *
 * `BriefService` is the ONLY consumer of `brief/repository.ts` in this
 * module — never touches `db`/`schema` directly (checked by this task's
 * layering grep). Mirrors `intent/service.ts`'s cache/in-flight-join shape
 * throughout; see the module-level `inFlightGenerations` comment below for
 * why that map must stay module-, not instance-, scoped.
 */

/** D13 — the input-token budget is a fixed server constant, not
 *  per-workspace/per-agent configurable. */
const BRIEF_TOKEN_BUDGET = 8000;

/** AC-28's "budget rejection" outcome, thrown from inside the generation
 *  `try` block so the single `catch` (and its `describeFailure`) can tell it
 *  apart from a model/transport failure without inspecting message text. */
class BriefBudgetExceededError extends Error {
  constructor() {
    super('PR Brief input exceeds the token budget even after dropping every droppable section');
    this.name = 'BriefBudgetExceededError';
  }
}

/**
 * Per-`(prId, agentId, stateKey)` in-flight-generation dedup (AC-21),
 * mirroring `intent/service.ts:51`'s module-level `Map`: two concurrent
 * `POST` calls for the SAME state (including a `force: true` regenerate
 * racing a plain request) join one generation instead of paying for two LLM
 * calls, while a request for a NEW state (a fresh commit, an edited doc)
 * starts its own generation instead of joining and receiving a Brief for
 * the old state. Deliberately module-level, not an instance field — see
 * `intent/service.ts`'s equivalent comment for the full rationale (a fresh
 * `BriefService` is constructed per request/route, so an instance-level map
 * would never actually dedup anything). Single-process only, same
 * documented limitation as `intent/service.ts`.
 */
const inFlightGenerations = new Map<string, Promise<BriefResult>>();

export class BriefService {
  private repo: BriefRepository;

  constructor(private container: Container) {
    this.repo = new BriefRepository(container.db);
  }

  /**
   * `GET /pulls/:id/brief` — cheap path. Never calls `gatherBriefSignals`,
   * `readBodies`, `getPrFiles`, `BlastService`, `github()`, or the LLM. Hit
   * → the stored Brief with `cached: true`. Miss → `{brief: null, cached:
   * false, ...}` (AC-19: a row under a DIFFERENT state key is never
   * returned).
   */
  async get(workspaceId: string, prId: string, agentId: string, logger?: PinoLike): Promise<BriefResult> {
    await this.requireAgent(workspaceId, agentId);
    const { pull, repo } = await this.requirePull(workspaceId, prId);
    const keyResult = await computeBriefStateKey({ container: this.container, pull, repo, agentId });

    const row = await this.repo.getBriefByStateKey(prId, agentId, keyResult.stateKey);
    const result = row
      ? toBriefResult(row, true)
      : emptyBriefResult(keyResult.stateKey, keyResult.intentAvailable);

    this.logOutcome(logger, {
      prId,
      agentId,
      stateKey: keyResult.stateKey,
      provider: row?.provider ?? null,
      model: row?.model ?? null,
      tokensIn: row?.tokensIn ?? null,
      tokensOut: row?.tokensOut ?? null,
      attempts: row?.attempts ?? null,
      cached: result.cached,
      ok: true,
      reason: undefined,
      droppedSections: result.dropped_sections.length,
      droppedCitations: result.dropped_citations.length,
      durationMs: 0,
    });

    return result;
  }

  /**
   * `POST /pulls/:id/brief` — cache-or-generate. `force: true` skips only
   * the cache LOOKUP, never the in-flight join (AC-18, AC-21).
   */
  async ensureForPull(
    workspaceId: string,
    prId: string,
    opts: { agentId: string; force?: boolean; logger?: PinoLike },
  ): Promise<BriefResult> {
    const { agentId, force = false, logger } = opts;
    await this.requireAgent(workspaceId, agentId);
    const { pull, repo } = await this.requirePull(workspaceId, prId);
    const keyResult = await computeBriefStateKey({ container: this.container, pull, repo, agentId });
    const { stateKey } = keyResult;

    if (!force) {
      const existing = await this.repo.getBriefByStateKey(prId, agentId, stateKey);
      if (existing) {
        const result = toBriefResult(existing, true);
        this.logOutcome(logger, {
          prId,
          agentId,
          stateKey,
          provider: existing.provider,
          model: existing.model,
          tokensIn: existing.tokensIn,
          tokensOut: existing.tokensOut,
          attempts: existing.attempts,
          cached: true,
          ok: true,
          reason: undefined,
          droppedSections: result.dropped_sections.length,
          droppedCitations: result.dropped_citations.length,
          durationMs: 0,
        });
        return result;
      }
    }

    // TOCTOU guard, same shape as `intent/service.ts:121-137`: the
    // cache-check above (and `force`) can both let two concurrent callers
    // reach this point for the same `(prId, agentId, stateKey)` before
    // either has persisted anything. Join an already-running generation
    // instead of starting a second one.
    const mapKey = `${prId}:${agentId}:${stateKey}`;
    const inFlight = inFlightGenerations.get(mapKey);
    if (inFlight) {
      logger?.info({ prId, agentId, stateKey }, 'brief: joining in-flight generation, 0 additional LLM calls');
      return inFlight;
    }

    const generation = this.generate(workspaceId, pull, repo, agentId, keyResult, logger);
    inFlightGenerations.set(mapKey, generation);
    // Clean up on both success and failure — see `intent/service.ts`'s
    // equivalent comment. `.catch(() => {})` only swallows the rejection on
    // this secondary listener; the `generation` promise returned below still
    // rejects normally for whoever awaits `ensureForPull`.
    generation.finally(() => inFlightGenerations.delete(mapKey)).catch(() => {});
    return generation;
  }

  /** `gatherBriefSignals → trimToBudget → resolveFeatureModel + llm →
   *  generateBrief → groundBriefCitations → upsertBrief`, wrapped in one
   *  `try/catch` so the fourth `logOutcome` call site (failure) can log AND
   *  rethrow (AC-29: a failed generation is still a completed request). */
  private async generate(
    workspaceId: string,
    pull: PullRow,
    repo: RepoRow,
    agentId: string,
    keyResult: Awaited<ReturnType<typeof computeBriefStateKey>>,
    logger?: PinoLike,
  ): Promise<BriefResult> {
    const start = Date.now();
    const { stateKey, resolvedPaths, docsMetaFingerprint, indexSha } = keyResult;
    let provider: string | null = null;
    let model: string | null = null;

    try {
      const signals = await gatherBriefSignals(this.container, workspaceId, pull, repo, agentId, resolvedPaths);

      const budget = trimToBudget(
        signals.sections,
        BRIEF_TOKEN_BUDGET,
        this.container.tokenizer,
        assembleBriefPrompt,
      );
      if (!budget.ok) throw new BriefBudgetExceededError();

      const resolved = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
      provider = resolved.provider;
      model = resolved.model;
      const llm = await this.container.llm(resolved.provider);

      const generated = await generateBrief({
        llm,
        model: resolved.model,
        sections: budget.sections,
        sessionId: `${repo.owner}/${repo.name}#${pull.number}:brief`,
      });

      const grounded = groundBriefCitations(generated.brief, signals.accepted);
      const brief: Brief = {
        what: generated.brief.what,
        why: generated.brief.why,
        risk_level: generated.brief.risk_level,
        risks: grounded.kept.risks,
        review_focus: grounded.kept.review_focus,
      };

      const row = await this.repo.upsertBrief({
        prId: pull.id,
        agentId,
        stateKey,
        headSha: pull.headSha,
        docsMetaFingerprint,
        docsContentFingerprint: signals.docsContentFingerprint,
        indexSha,
        json: brief,
        intentAvailable: signals.intentAvailable,
        blastAvailable: signals.blastAvailable,
        droppedSections: budget.dropped,
        droppedCitations: grounded.dropped,
        provider: resolved.provider,
        model: resolved.model,
        tokensIn: generated.tokensIn,
        tokensOut: generated.tokensOut,
        attempts: generated.attempts,
        costUsd: generated.costUsd,
      });

      const result = toBriefResult(row, false);
      this.logOutcome(logger, {
        prId: pull.id,
        agentId,
        stateKey,
        provider: resolved.provider,
        model: resolved.model,
        tokensIn: generated.tokensIn,
        tokensOut: generated.tokensOut,
        attempts: generated.attempts,
        cached: false,
        ok: true,
        reason: undefined,
        droppedSections: result.dropped_sections.length,
        droppedCitations: result.dropped_citations.length,
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err) {
      this.logOutcome(logger, {
        prId: pull.id,
        agentId,
        stateKey,
        provider,
        model,
        tokensIn: null,
        tokensOut: null,
        attempts: null,
        cached: false,
        ok: false,
        reason: describeFailure(err),
        droppedSections: 0,
        droppedCitations: 0,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  }

  /**
   * Workspace-ownership check the route's `z.string().uuid()` shape
   * validation does not provide — without it a caller could name a
   * deleted/nonexistent/foreign-workspace agent and have
   * `resolveForAgent(agentId)` (which takes no `workspaceId`) happily
   * resolve another workspace's attached document set. Runs BEFORE any
   * other work in both handlers.
   *
   * S-2: `enabled: false` throws here, intentionally STRICTER than
   * `RunReviewDropdown` (which does allow running a disabled agent) — this
   * divergence is approved, not a bug to "fix".
   */
  private async requireAgent(workspaceId: string, agentId: string) {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    if (!agent.enabled) throw new ValidationError('Agent is disabled');
    return agent;
  }

  private async requirePull(
    workspaceId: string,
    prId: string,
  ): Promise<{ pull: PullRow; repo: RepoRow }> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const repo = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pull, repo };
  }

  /**
   * AC-29 — one shape, four call sites (GET, POST cache hit, POST
   * generation success, POST generation failure). Never logs a document
   * body, the PR body, a diff, or any model prose — counts, identifiers and
   * a short machine reason code only.
   */
  private logOutcome(
    logger: PinoLike | undefined,
    fields: {
      prId: string;
      agentId: string;
      stateKey: string;
      provider: string | null;
      model: string | null;
      tokensIn: number | null;
      tokensOut: number | null;
      attempts: number | null;
      cached: boolean;
      ok: boolean;
      reason: string | undefined;
      droppedSections: number;
      droppedCitations: number;
      durationMs: number;
    },
  ): void {
    logger?.info(fields, `brief: ${fields.ok ? 'completed' : 'failed'} (cached=${fields.cached})`);
  }
}

/** Maps a thrown error from the `generate()` sequence to AC-29's fixed
 *  machine reason code set. `BriefBudgetExceededError` and `ConfigError`
 *  (thrown by `container.llm()` when a provider's secret key is missing)
 *  are told apart by type; anything else (schema-invalid model output,
 *  transport failure, a persistence error) is reported as `model_error`. */
function describeFailure(err: unknown): 'budget_exceeded' | 'model_error' | 'missing_model_config' {
  if (err instanceof BriefBudgetExceededError) return 'budget_exceeded';
  if (err instanceof ConfigError) return 'missing_model_config';
  return 'model_error';
}

function emptyBriefResult(stateKey: string, intentAvailable: boolean): BriefResult {
  return {
    brief: null,
    cached: false,
    state_key: stateKey,
    intent_available: intentAvailable,
    blast_available: false,
    dropped_sections: [],
    dropped_citations: [],
    generated_at: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: null,
  };
}

function toBriefResult(row: BriefRow, cached: boolean): BriefResult {
  return {
    brief: row.json,
    cached,
    state_key: row.stateKey,
    intent_available: row.intentAvailable,
    blast_available: row.blastAvailable,
    dropped_sections: row.droppedSections,
    dropped_citations: row.droppedCitations,
    generated_at: row.generatedAt.toISOString(),
    tokens_in: row.tokensIn,
    tokens_out: row.tokensOut,
    cost_usd: row.costUsd,
  };
}
