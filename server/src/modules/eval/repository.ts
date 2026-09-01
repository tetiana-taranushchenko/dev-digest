import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalOwnerKind } from '@devdigest/shared';

/**
 * T1 — eval data-access. Owns `eval_cases` and `eval_runs`. Workspace-scoped
 * throughout (via `eval_cases.workspace_id`; `eval_runs` has no workspace_id
 * column of its own, so run-scoped reads join through `eval_cases`).
 *
 * `eval_runs.case_id` cascades on delete of its `eval_cases` row (FK,
 * `db/schema/eval.ts:24-26`) — deleting a case removes its runs with no extra
 * code here (AC-5), verified by a T7 integration test.
 */

import type { EvalCaseRow, EvalRunRow } from '../../db/rows.js';
export type { EvalCaseRow, EvalRunRow };

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  ownerKind?: EvalOwnerKind;
  ownerId?: string;
  name?: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  actualOutput?: unknown;
  pass?: boolean | null;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
}

export interface EvalCaseFilter {
  ownerKind?: EvalOwnerKind;
  ownerId?: string;
}

export interface EvalDashboardScope {
  workspaceId: string;
  ownerKind?: EvalOwnerKind;
  ownerId?: string;
}

/**
 * One `eval_runs` row joined with its case's name — the read shape the
 * dashboard aggregation (`eval/dashboard.ts`, T3) consumes. `per_trace`
 * already lives inside `actual_output` (Implementation Recommendations #1),
 * so no `expected_output` join is needed here.
 */
export interface DashboardRunRow {
  id: string;
  case_id: string;
  case_name: string;
  ran_at: string;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
  duration_ms: number | null;
  cost_usd: number | null;
  actual_output: unknown;
}

export class EvalRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string, filter?: EvalCaseFilter): Promise<EvalCaseRow[]> {
    const conditions = [eq(t.evalCases.workspaceId, workspaceId)];
    if (filter?.ownerKind) conditions.push(eq(t.evalCases.ownerKind, filter.ownerKind));
    if (filter?.ownerId) conditions.push(eq(t.evalCases.ownerId, filter.ownerId));
    return this.db
      .select()
      .from(t.evalCases)
      .where(and(...conditions));
  }

  async getById(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async insert(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? null,
        inputFiles: values.inputFiles ?? null,
        inputMeta: values.inputMeta ?? null,
        expectedOutput: values.expectedOutput ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.ownerKind !== undefined ? { ownerKind: patch.ownerKind } : {}),
        ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta } : {}),
        ...(patch.expectedOutput !== undefined ? { expectedOutput: patch.expectedOutput } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** Delete a case (workspace-scoped). Its runs cascade via FK onDelete. */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  /** Persist one run's outcome for a case. */
  async insertRun(caseId: string, result: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId,
        actualOutput: result.actualOutput ?? null,
        pass: result.pass ?? null,
        recall: result.recall ?? null,
        precision: result.precision ?? null,
        citationAccuracy: result.citationAccuracy ?? null,
        durationMs: result.durationMs ?? null,
        costUsd: result.costUsd ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Every run for the given scope (a single owner, or the whole workspace
   * when `ownerKind`/`ownerId` are omitted), joined with its case's name,
   * oldest first — `eval/dashboard.ts` (T3) re-sorts defensively but this is
   * the natural order for its single forward walk.
   */
  async listRunsForDashboard(scope: EvalDashboardScope): Promise<DashboardRunRow[]> {
    const conditions = [eq(t.evalCases.workspaceId, scope.workspaceId)];
    if (scope.ownerKind) conditions.push(eq(t.evalCases.ownerKind, scope.ownerKind));
    if (scope.ownerId) conditions.push(eq(t.evalCases.ownerId, scope.ownerId));

    const rows = await this.db
      .select({
        id: t.evalRuns.id,
        case_id: t.evalRuns.caseId,
        case_name: t.evalCases.name,
        ran_at: t.evalRuns.ranAt,
        pass: t.evalRuns.pass,
        recall: t.evalRuns.recall,
        precision: t.evalRuns.precision,
        citation_accuracy: t.evalRuns.citationAccuracy,
        duration_ms: t.evalRuns.durationMs,
        cost_usd: t.evalRuns.costUsd,
        actual_output: t.evalRuns.actualOutput,
      })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(...conditions))
      .orderBy(asc(t.evalRuns.ranAt));

    return rows.map((r) => ({ ...r, ran_at: r.ran_at.toISOString() }));
  }

  /** Total eval cases in scope — feeds `EvalDashboard.cases_total` (may be >
   *  0 even when zero runs exist yet, AC-19). */
  async countCases(scope: EvalDashboardScope): Promise<number> {
    const conditions = [eq(t.evalCases.workspaceId, scope.workspaceId)];
    if (scope.ownerKind) conditions.push(eq(t.evalCases.ownerKind, scope.ownerKind));
    if (scope.ownerId) conditions.push(eq(t.evalCases.ownerId, scope.ownerId));
    const rows = await this.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(and(...conditions));
    return rows.length;
  }
}
