/* hooks/eval.ts — React Query hooks for the eval pipeline (T8).
   CRUD + run + bulk-run-poll + dashboard hooks over the `eval` module's
   11 endpoints (server/src/modules/eval/routes.ts). Read hooks mirror
   `useSmartDiff`'s shape (queryKey, enabled, retry: false); write hooks are
   `useMutation` + query invalidation, matching hooks/agents.ts. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseInput,
  EvalDashboard,
  EvalOwnerKind,
  EvalRunResult,
} from "@devdigest/shared";

/** Optional owner scope shared by the list + dashboard reads. */
export interface EvalOwnerFilter {
  owner_kind?: EvalOwnerKind;
  owner_id?: string;
}

function ownerQueryString(filter?: EvalOwnerFilter): string {
  const params = new URLSearchParams();
  if (filter?.owner_kind) params.set("owner_kind", filter.owner_kind);
  if (filter?.owner_id) params.set("owner_id", filter.owner_id);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ===========================================================================
// Eval cases — CRUD (AC-1, AC-2, AC-4, AC-5)
// ===========================================================================

export function useEvalCases(filter?: EvalOwnerFilter) {
  return useQuery({
    queryKey: ["eval-cases", filter?.owner_kind ?? "", filter?.owner_id ?? ""],
    queryFn: () => api.get<EvalCase[]>(`/eval-cases${ownerQueryString(filter)}`),
    retry: false,
  });
}

export function useEvalCase(id: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", id],
    queryFn: () => api.get<EvalCase>(`/eval-cases/${id}`),
    enabled: !!id,
    retry: false,
  });
}

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseInput) => api.post<EvalCase>("/eval-cases", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["eval-cases"] }),
  });
}

export interface UpdateEvalCaseInput {
  id: string;
  input: EvalCaseInput;
}

export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: UpdateEvalCaseInput) =>
      api.put<EvalCase>(`/eval-cases/${id}`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.setQueryData(["eval-case", data.id], data);
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.removeQueries({ queryKey: ["eval-case", id] });
    },
  });
}

// ===========================================================================
// Running (AC-7, AC-13, AC-43, AC-47)
// ===========================================================================

/** Run one case synchronously — persists exactly one `eval_runs` row and
 *  returns its metrics. A run changes the case's "last run" state and the
 *  owner's dashboard, so both are invalidated on success. */
export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.post<EvalRunResult>(`/eval-cases/${caseId}/run`),
    onSuccess: (_data, caseId) => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.invalidateQueries({ queryKey: ["eval-case", caseId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-overview"] });
    },
  });
}

/** Starts a bulk run for one owner (both filters present, AC-13) or the
 *  whole workspace (both omitted, "Run all agents", AC-43). Fire-and-forget
 *  — resolves immediately with a pollable batch id; poll it with
 *  `useBulkRunStatus`. */
export function useRunAllEvals() {
  return useMutation({
    mutationFn: (filter: EvalOwnerFilter = {}) =>
      api.post<{ batch_id: string; total: number }>("/eval-cases/run-all", filter),
  });
}

/**
 * In-flight (or just-finished) state of one bulk-run batch — mirrors
 * `server/src/modules/eval/run-tracker.ts`'s `EvalBatchState`. Not part of
 * `@devdigest/shared` (it's a process-local server type, never persisted),
 * so it's redeclared here for the client response shape.
 */
export interface EvalBatchState {
  total: number;
  completed: number;
  results: EvalRunResult[];
  errors: { case_id: string; message: string }[];
  status: "running" | "done";
}

/** Polls a bulk-run batch's progress while it's still `running` (AC-47) —
 *  self-clears once the batch reaches `done`. */
export function useBulkRunStatus(batchId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-run-batch", batchId],
    queryFn: () => api.get<EvalBatchState>(`/eval-cases/run-all/${batchId}`),
    enabled: !!batchId,
    retry: false,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2000 : false),
  });
}

// ===========================================================================
// Dashboard (AC-16, AC-17, AC-31)
// ===========================================================================

export function useEvalDashboard(filter?: EvalOwnerFilter) {
  return useQuery({
    queryKey: ["eval-dashboard", filter?.owner_kind ?? "", filter?.owner_id ?? ""],
    queryFn: () => api.get<EvalDashboard>(`/eval-dashboard${ownerQueryString(filter)}`),
    retry: false,
  });
}

/** One dashboard per owner that has >=1 eval case (AC-31) — the cross-owner
 *  overview backing the eval dashboard page. */
export function useEvalOverview() {
  return useQuery({
    queryKey: ["eval-overview"],
    queryFn: () => api.get<EvalDashboard[]>("/eval-dashboard/overview"),
    retry: false,
  });
}

// ===========================================================================
// Seed from finding (AC-27, AC-29)
// ===========================================================================

/** Builds an (unsaved) `EvalCaseInput` draft from an existing finding —
 *  "Turn into eval case". A read in spirit (no persistence), but it's a
 *  POST server-side, so it's exposed as a mutation the caller triggers on
 *  demand rather than a query keyed to a stable resource. */
export function useEvalSeed() {
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<EvalCaseInput>(`/findings/${findingId}/eval-seed`),
  });
}
