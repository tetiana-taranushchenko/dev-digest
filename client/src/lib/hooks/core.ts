/* hooks/core.ts — typed React Query hooks over the F1 API (contracts):
   settings, secrets, repos, pulls, and project context. Scaffolding screens use
   these; feature-domain hooks live in the sibling files (agents/reviews/trace/…)
   and are re-exported alongside these from hooks/index.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  Settings,
  SettingsUpdate,
  ConnTestProvider,
  ConnTestResult,
  SecretsStatus,
  Repo,
  PrMeta,
  PrDetail,
} from "../types";
import type {
  ContextListing,
  ContextIndexStatus,
  ContextDocument,
  SaveContextDocumentBody,
  SaveContextDocumentResult,
  CreateContextEntryBody,
  CreateContextEntryResult,
} from "@devdigest/shared";

// ---- Settings (F1: GET/PUT /settings, POST /settings/test-connection) ----
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/settings"),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => api.put<Settings>("/settings", patch),
    onSuccess: (data) => qc.setQueryData(["settings"], data),
  });
}

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnTestProvider | { provider: ConnTestProvider; key?: string }) => {
      const body = typeof input === "string" ? { provider: input } : input;
      return api.post<ConnTestResult>("/settings/test-connection", body);
    },
    // Saving/validating a provider key can change which models resolve — drop the
    // cached (possibly empty) model lists so the agent picker refetches, and
    // refresh the "Configured / Not set" key-status badges.
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ["provider-models"] });
        qc.invalidateQueries({ queryKey: ["secrets-status"] });
      }
    },
  });
}

/** Which provider keys are configured (booleans only — never the values). */
export function useSecretsStatus() {
  return useQuery({
    queryKey: ["secrets-status"],
    queryFn: () => api.get<SecretsStatus>("/settings/secrets-status"),
    staleTime: 30_000,
  });
}

// ---- Repos (F1: GET/POST /repos, refresh, delete) ----
export function useRepos() {
  return useQuery({
    queryKey: ["repos"],
    queryFn: () => api.get<Repo[]>("/repos"),
  });
}

export function useAddRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => api.post<Repo>("/repos", { url }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

export function useRefreshRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<Repo>(`/repos/${repoId}/refresh`),
    onSuccess: (_d, repoId) => {
      qc.invalidateQueries({ queryKey: ["repos"] });
      qc.invalidateQueries({ queryKey: ["pulls", repoId] });
    },
  });
}

export function useDeleteRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.del<{ deleted: string }>(`/repos/${repoId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
}

/** POST /repos/:id/poll response — syncs PR title/body/commits/files from
 *  GitHub into DevDigest's Postgres copy. Manual refresh only; never triggers
 *  a review (see server/src/modules/polling/routes.ts). */
interface PollResult {
  synced: number;
  reviewTriggered: false;
}

export function useSyncRepo(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PollResult>(`/repos/${repoId}/poll`),
    onSuccess: () => {
      // Sync can update any PR in the repo (title/body/commits/files) — drop
      // the list cache and every cached PR detail so the UI reflects fresh
      // data without a manual reload.
      qc.invalidateQueries({ queryKey: ["pulls", repoId] });
      qc.invalidateQueries({ queryKey: ["pull"] });
    },
  });
}

// ---- Pull requests (F1: GET /repos/:id/pulls, GET /pulls/:id) ----
export function usePulls(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["pulls", repoId],
    queryFn: () => api.get<PrMeta[]>(`/repos/${repoId}/pulls`),
    enabled: !!repoId,
    // Auto-refresh PR statuses: re-sync from GitHub every 60s while the page is
    // open, and whenever the window regains focus.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePullDetail(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["pull", prId],
    queryFn: () => api.get<PrDetail>(`/pulls/${prId}`),
    enabled: prId != null,
  });
}

// ---- Project Context (GET /repos/:id/context, POST /repos/:id/context/reindex) ----
/** Documents discovered under `specs/`/`docs/`/`insights/` plus index freshness
 *  (`ContextListing` — files + index, T7/T8). */
export function useContextFiles(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["context", repoId],
    queryFn: () => api.get<ContextListing>(`/repos/${repoId}/context`),
    enabled: !!repoId,
  });
}

export function useReindexContext() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) => api.post<ContextIndexStatus>(`/repos/${repoId}/context/reindex`),
    onSuccess: (_d, repoId) => qc.invalidateQueries({ queryKey: ["context", repoId] }),
  });
}

// ---- Project Context document authoring
// (GET/PUT /repos/:id/context/document, POST /repos/:id/context/entries,
//  POST /repos/:id/context/upload — T8, `docs/plans/project-context-authoring.md`) ----

/** A selected document's real content, fresh from the clone. Only fetches when
 *  both `repoId` and `path` are set — never auto-fetch with no selection
 *  (AC-3) and never fetch a body for the list ("bodies on demand only" NFR). */
export function useContextDocument(repoId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: ["context-doc", repoId, path],
    queryFn: () =>
      api.get<ContextDocument>(`/repos/${repoId}/context/document?path=${encodeURIComponent(path!)}`),
    enabled: !!repoId && !!path,
  });
}

interface SaveContextDocumentInput extends SaveContextDocumentBody {
  repoId: string;
}

/** Save writes immediately (no confirm step, no autosave). A successful save
 *  refreshes both the status line/list (AC-10) and this document's cached
 *  metadata + content, without a page reload. */
export function useSaveContextDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, ...body }: SaveContextDocumentInput) =>
      api.put<SaveContextDocumentResult>(`/repos/${repoId}/context/document`, body),
    onSuccess: (_data, { repoId, path }) => {
      qc.invalidateQueries({ queryKey: ["context", repoId] });
      qc.invalidateQueries({ queryKey: ["context-doc", repoId, path] });
    },
  });
}

interface CreateContextEntryInput extends CreateContextEntryBody {
  repoId: string;
}

/** New file / new folder under the write root. Refreshes the list/status line
 *  and the affected document's cache (AC-10, AC-12, AC-13). */
export function useCreateContextEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, ...body }: CreateContextEntryInput) =>
      api.post<CreateContextEntryResult>(`/repos/${repoId}/context/entries`, body),
    onSuccess: (_data, { repoId, path }) => {
      qc.invalidateQueries({ queryKey: ["context", repoId] });
      qc.invalidateQueries({ queryKey: ["context-doc", repoId, path] });
    },
  });
}

interface UploadContextDocumentInput {
  repoId: string;
  file: File;
}

/** Toolbar file-picker upload (`.md` only, never drag-and-drop). Refreshes
 *  the list/status line and the uploaded document's cache (AC-10, AC-15). */
export function useUploadContextDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, file }: UploadContextDocumentInput) => {
      const formData = new FormData();
      formData.append("file", file);
      return api.upload<CreateContextEntryResult>(`/repos/${repoId}/context/upload`, formData);
    },
    onSuccess: (result, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["context", repoId] });
      qc.invalidateQueries({ queryKey: ["context-doc", repoId, result.path] });
    },
  });
}
