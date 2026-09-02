import { reviewPullRequest, wrapUntrusted } from '@devdigest/reviewer-core';
import type { EvalCase, EvalCaseInput, EvalDashboard, EvalOwnerKind, EvalRunResult } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { parseUnifiedDiff } from '../../adapters/index.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import { EVAL_DEFAULT_STRATEGY, EVAL_RUN_TASK } from './constants.js';
import { EvalOwnerUnavailableError } from './errors.js';
import {
  EvalRepository,
  type EvalCaseFilter,
  type EvalCaseRow,
  type EvalDashboardScope,
} from './repository.js';
import { EvalRunInProgressError, EvalRunTracker, scopeKeyFor, type EvalBatchState } from './run-tracker.js';
import { buildActualOutput, EvalScoringError, parseExpectedFindings, scoreCase } from './scorer.js';
import { buildDashboard } from './dashboard.js';
import {
  buildExpectedOutputFromFinding,
  buildSeedCaseName,
  isUuid,
  loadDiffForEval,
  sliceDiffForSeed,
  toEvalCaseDto,
} from './helpers.js';

/**
 * Eval application service (`modules/eval/service.ts`, T5). Orchestrates:
 * CRUD over `eval_cases` (via `repository.ts`, T1), running one case or a
 * whole owner's cases through `reviewPullRequest` (reviewer-core) +
 * `scorer.ts` (T2, pure), aggregating dashboards via `dashboard.ts` (T3,
 * pure), tracking bulk-run progress via `run-tracker.ts` (T4, in-process),
 * and seeding a case from an existing finding.
 *
 * Never imports Drizzle `db`/`schema` directly — every read/write goes
 * through `EvalRepository`'s typed function surface (dependency inversion,
 * `onion-architecture` skill).
 */

/** Minimal logging surface — mirrors `reviews/run-executor.ts`'s `Logger`
 *  shape without importing that module-private file. Optional: nothing in
 *  `Container` exposes a bare logger, and every per-case failure inside a
 *  bulk run is already recorded via `run-tracker.ts` regardless of whether a
 *  logger was supplied. */
type EvalLogger = { error: (obj: unknown, msg?: string) => void };

/** The resolved owner config a run executes against (Implementation
 *  Recommendations #3 — a skill's cases run through its linked agent's
 *  *whole* current config, not the skill in isolation). */
interface EvalRunConfig {
  agent: AgentRow;
  /** Enabled linked-skill bodies, in order, delimiter-wrapped for
   *  non-manual/extracted sources — identical treatment to a live PR review. */
  skillBodies: string[];
}

export class EvalService {
  private repo: EvalRepository;
  private runTracker = new EvalRunTracker();

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
  }

  // ===========================================================================
  // CRUD (AC-1, AC-2, AC-3, AC-4)
  // ===========================================================================

  async listCases(workspaceId: string, filter?: EvalCaseFilter): Promise<EvalCase[]> {
    const rows = await this.repo.list(workspaceId, filter);
    return rows.map(toEvalCaseDto);
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCase | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toEvalCaseDto(row) : undefined;
  }

  /** Persists nothing when `owner_id` doesn't validate (AC-3). */
  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    await this.validateOwner(workspaceId, input.owner_kind, input.owner_id);
    const row = await this.repo.insert({
      workspaceId,
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes,
    });
    return toEvalCaseDto(row);
  }

  /** Returns `undefined` on cross-workspace/missing (AC-4) — the route maps
   *  that to a 404, same convention as `skills`/`agents` services. Still
   *  re-validates `owner_id` (AC-3 applies to updates too). */
  async updateCase(workspaceId: string, id: string, input: EvalCaseInput): Promise<EvalCase | undefined> {
    await this.validateOwner(workspaceId, input.owner_kind, input.owner_id);
    const row = await this.repo.update(workspaceId, id, {
      ownerKind: input.owner_kind,
      ownerId: input.owner_id,
      name: input.name,
      inputDiff: input.input_diff,
      inputFiles: input.input_files,
      inputMeta: input.input_meta,
      expectedOutput: input.expected_output,
      notes: input.notes,
    });
    return row ? toEvalCaseDto(row) : undefined;
  }

  /** Returns `false` on cross-workspace/missing (AC-4). Runs cascade via FK
   *  (AC-5) — no extra code needed here. */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /** Shape + existence check for `owner_id` (AC-3): a malformed uuid is a
   *  `ValidationError`; a well-formed one that doesn't resolve to an
   *  agent/skill in this workspace is a `NotFoundError`. Never persists on
   *  failure — this always runs before any repository write. */
  private async validateOwner(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<void> {
    if (!isUuid(ownerId)) {
      throw new ValidationError('owner_id must be a UUID');
    }
    const exists =
      ownerKind === 'agent'
        ? await this.container.agentsRepo.getById(workspaceId, ownerId)
        : await this.container.skillsRepo.getById(workspaceId, ownerId);
    if (!exists) {
      throw new NotFoundError(ownerKind === 'agent' ? 'Agent not found' : 'Skill not found');
    }
  }

  // ===========================================================================
  // Running (AC-7…AC-14, AC-38, AC-40, AC-42, AC-47)
  // ===========================================================================

  /**
   * Run one case synchronously (AC-7): parse `expected_output`/`input_diff`,
   * resolve the owner's run config, execute `reviewPullRequest`, score, and
   * persist exactly one `eval_runs` row. On a parse failure, throws
   * `ValidationError` and persists nothing (AC-12) — validated BEFORE the
   * (expensive) LLM call.
   */
  async runCase(workspaceId: string, caseId: string): Promise<EvalRunResult> {
    const caseRow = await this.repo.getById(workspaceId, caseId);
    if (!caseRow) throw new NotFoundError('Eval case not found');

    let expected;
    try {
      expected = parseExpectedFindings(caseRow.expectedOutput);
    } catch (err) {
      if (err instanceof EvalScoringError) throw new ValidationError(err.message);
      throw err;
    }

    const diff = parseUnifiedDiff(caseRow.inputDiff ?? '');
    const { agent, skillBodies } = await this.buildRunConfig(workspaceId, caseRow.ownerKind, caseRow.ownerId);

    const start = Date.now();
    const outcome = await reviewPullRequest({
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      diff,
      llm: await this.container.llm(agent.provider),
      strategy: agent.strategy ?? EVAL_DEFAULT_STRATEGY,
      // Omitted (not `skills: []`) when the agent has none enabled, matching
      // `run-executor.ts`'s byte-identical-prompt convention.
      ...(skillBodies.length ? { skills: skillBodies } : {}),
      // Deliberately neutral (AC-8/AC-44's "matching is mechanical, no
      // model-visible hint" guarantee extends to the task line too) — never
      // interpolate `caseRow.name`/`expected_output` here (see EVAL_RUN_TASK).
      task: EVAL_RUN_TASK,
      sessionId: `eval:${caseRow.id}`,
    });
    const durationMs = Date.now() - start;

    // citation_accuracy = kept / (kept + dropped) — the citation gate the
    // engine already applied, never re-run here (AC-10).
    const score = scoreCase(expected, {
      findings: outcome.review.findings,
      kept: outcome.review.findings.length,
      dropped: outcome.dropped.length,
    });

    const actualOutput = buildActualOutput({ findings: outcome.review.findings }, { perTrace: score.perTrace });

    const runRow = await this.repo.insertRun(caseRow.id, {
      actualOutput,
      pass: score.pass,
      recall: score.recall,
      precision: score.precision,
      // The STORED value is null when nothing was grounded (AC-38); the
      // RESPONSE below uses the vacuously-accurate `1` in that case instead.
      citationAccuracy: score.citationAccuracyStored,
      durationMs,
      costUsd: outcome.costUsd,
    });

    return {
      run_id: runRow.id,
      case_id: caseRow.id,
      result: {
        recall: score.recall,
        precision: score.precision,
        citation_accuracy: score.citationAccuracyResponse,
        traces_passed: score.tracesPassed,
        traces_total: score.tracesTotal,
        duration_ms: durationMs,
        cost_usd: outcome.costUsd,
        per_trace: score.perTrace,
      },
    };
  }

  /**
   * Start a bulk run for one owner (both filters present, AC-13) or the
   * whole workspace ("Run all agents", both omitted, AC-43). Fire-and-forget
   * — exactly the `reviews/service.ts:133` `runReview` precedent AC-47 names
   * — returns immediately with a pollable batch id.
   */
  async startBulkRun(
    workspaceId: string,
    opts: { ownerKind?: EvalOwnerKind; ownerId?: string } = {},
    logger?: EvalLogger,
  ): Promise<{ batch_id: string; total: number }> {
    const cases = await this.repo.list(workspaceId, { ownerKind: opts.ownerKind, ownerId: opts.ownerId });
    const scopeKey = scopeKeyFor(opts.ownerKind, opts.ownerId);

    let batchId: string;
    try {
      batchId = this.runTracker.start(scopeKey, cases.length);
    } catch (err) {
      // A batch is already `running` for this scope (AC-15) — 409, not a
      // generic validation failure.
      if (err instanceof EvalRunInProgressError) throw new ConflictError(err.message);
      throw err;
    }

    void this.runBulk(workspaceId, scopeKey, cases, logger).catch((err) => {
      logger?.error({ err: (err as Error).message }, 'eval: bulk run crashed');
    });

    return { batch_id: batchId, total: cases.length };
  }

  /** Current status of a bulk-run batch, or `undefined` if none was ever
   *  started for this id — the route maps that to a 404. */
  bulkRunStatus(batchId: string): EvalBatchState | undefined {
    return this.runTracker.status(batchId);
  }

  /**
   * Run every case in the batch, one at a time. A single case's failure
   * (LLM error, provider quota, unparseable diff/expected_output) is caught
   * and recorded via `runTracker.recordError` — the loop NEVER aborts
   * (AC-14).
   */
  private async runBulk(
    workspaceId: string,
    scopeKey: string,
    cases: EvalCaseRow[],
    logger?: EvalLogger,
  ): Promise<void> {
    for (const evalCase of cases) {
      try {
        const result = await this.runCase(workspaceId, evalCase.id);
        this.runTracker.recordResult(scopeKey, result);
      } catch (err) {
        logger?.error({ caseId: evalCase.id, err: (err as Error).message }, 'eval: case run failed in bulk');
        this.runTracker.recordError(scopeKey, evalCase.id, (err as Error).message);
      }
    }
  }

  /**
   * Resolve which agent (and its currently-enabled linked-skill bodies) a
   * case's owner runs through (Implementation Recommendations #3): a
   * `'skill'` owner runs through its whole linked agent's live config, not
   * an isolated skill-only prompt.
   */
  private async buildRunConfig(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalRunConfig> {
    const agent = await this.resolveAgent(workspaceId, ownerKind, ownerId);
    const linkedSkills = await this.container.agentsRepo.linkedSkills(agent.id);
    const skillBodies = linkedSkills
      .filter((l) => l.skill.enabled)
      .map((l) =>
        l.skill.source === 'manual' || l.skill.source === 'extracted'
          ? l.skill.body
          : wrapUntrusted(`skill:${l.skill.id}`, l.skill.body),
      );
    return { agent, skillBodies };
  }

  private async resolveAgent(workspaceId: string, ownerKind: EvalOwnerKind, ownerId: string): Promise<AgentRow> {
    if (ownerKind === 'agent') {
      const agent = await this.container.agentsRepo.getById(workspaceId, ownerId);
      if (!agent) throw new NotFoundError('Agent not found');
      return agent;
    }

    const skill = await this.container.skillsRepo.getById(workspaceId, ownerId);
    if (!skill) throw new NotFoundError('Skill not found');

    // `agentsForSkill` does NOT filter by `agents.enabled` — fetch each
    // candidate (order asc) and return the first that's actually enabled.
    const candidates = [...(await this.container.skillsRepo.agentsForSkill(workspaceId, ownerId))].sort(
      (a, b) => a.order - b.order,
    );
    for (const candidate of candidates) {
      const agent = await this.container.agentsRepo.getById(workspaceId, candidate.agentId);
      if (agent?.enabled) return agent;
    }
    throw new EvalOwnerUnavailableError();
  }

  // ===========================================================================
  // Dashboard (AC-16, AC-17, AC-19, AC-31)
  // ===========================================================================

  async getDashboard(
    workspaceId: string,
    opts: { ownerKind?: EvalOwnerKind; ownerId?: string } = {},
  ): Promise<EvalDashboard> {
    const scope: EvalDashboardScope = { workspaceId, ownerKind: opts.ownerKind, ownerId: opts.ownerId };
    const [rows, casesTotal] = await Promise.all([
      this.repo.listRunsForDashboard(scope),
      this.repo.countCases(scope),
    ]);
    return buildDashboard(rows, casesTotal, opts.ownerKind ?? null, opts.ownerId ?? null);
  }

  /** One `EvalDashboard` per distinct owner that has ≥1 eval case in the
   *  workspace (AC-31) — the cross-owner overview. */
  async getOverview(workspaceId: string): Promise<EvalDashboard[]> {
    const cases = await this.repo.list(workspaceId);
    const seen = new Set<string>();
    const owners: { ownerKind: EvalOwnerKind; ownerId: string }[] = [];
    for (const c of cases) {
      const key = `${c.ownerKind}:${c.ownerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      owners.push({ ownerKind: c.ownerKind, ownerId: c.ownerId });
    }
    return Promise.all(owners.map((o) => this.getDashboard(workspaceId, o)));
  }

  // ===========================================================================
  // Seed from finding (AC-27, AC-28, AC-30)
  // ===========================================================================

  /**
   * Build an `EvalCaseInput` from an existing finding — "Turn into eval
   * case". `owner_kind` is always `'agent'` (findings only come from agent
   * reviews); `owner_id` is `''` when the finding's review has no resolvable
   * agent (AC-30) — `createCase`'s own `owner_id` validation independently
   * rejects that at save time as defense in depth.
   */
  async seedFromFinding(workspaceId: string, findingId: string): Promise<EvalCaseInput> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;

    const repo = await this.container.reviewRepo.getRepo(pull.repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const diff = await loadDiffForEval(this.container, pull, repo);
    const inputDiff = sliceDiffForSeed(diff, finding.file);

    return {
      owner_kind: 'agent',
      owner_id: review.agentId ?? '',
      name: buildSeedCaseName(finding),
      input_diff: inputDiff,
      expected_output: buildExpectedOutputFromFinding(finding),
    };
  }
}
