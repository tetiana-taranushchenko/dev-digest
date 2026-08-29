/* useContextAuthoring.ts — the Project Context authoring state machine
   (T9, `docs/plans/project-context-authoring.md`). No JSX: this is the
   "thin component + custom hook" extraction (react-frontend-architecture)
   that keeps `DocumentDetail` (T10) and `ContextView` (T11) presentational
   and independently testable. Owns: which document is selected (AC-3),
   Preview/Edit mode (AC-5), the draft/isDirty/conflict/save machinery
   (AC-6…AC-11), the unsaved-changes confirm gate (AC-8), and the
   session-scoped "has this session written anything" flag that arms the
   Re-index confirmation together with `isDirty` (AC-29). */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ContextDocMode,
  PendingContextAction,
  SaveOutcome,
  UseContextAuthoringResult,
} from "./types";
import {
  useContextDocument,
  useCreateContextEntry,
  useSaveContextDocument,
  useUploadContextDocument,
} from "../../../../lib/hooks/core";
import { ApiError } from "../../../../lib/api";
import type { CreateContextEntryBody } from "@devdigest/shared";

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useContextAuthoring(
  repoId: string | null | undefined,
): UseContextAuthoringResult {
  const t = useTranslations("context");

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setModeState] = useState<ContextDocMode>("preview");
  /** `null` means "no local edits" — draft mirrors on-disk content (derived
   *  below, never a `useState` copy of it). A non-null override is only ever
   *  set by `setDraft`. */
  const [draftOverride, setDraftOverride] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState<SaveOutcome | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingContextAction | null>(null);
  const [hasWrittenThisSession, setHasWrittenThisSession] = useState(false);

  const docQuery = useContextDocument(repoId, selectedPath);
  const saveMutation = useSaveContextDocument();
  const createMutation = useCreateContextEntry();
  const uploadMutation = useUploadContextDocument();

  const document = docQuery.data;

  // Derive, don't store: draft/isDirty are computed from draftOverride +
  // the loaded document on every render, never mirrored into their own
  // useState/useEffect pair.
  const draft = draftOverride ?? document?.content ?? "";
  const isDirty = document != null && draft !== document.content;

  const isDocLoading = !!selectedPath && docQuery.isLoading;
  const isDocError = docQuery.isError;
  const docErrorMessage = docQuery.isError
    ? docQuery.error instanceof ApiError
      ? docQuery.error.message
      : t("editor.loadError")
    : null;

  const needsReindexConfirm = isDirty || hasWrittenThisSession;

  function applySelect(path: string, nextMode: ContextDocMode | undefined) {
    setSelectedPath(path);
    setDraftOverride(null);
    setModeState(nextMode ?? "preview");
    setConflict(false);
    setSaveOutcome(null);
  }

  function selectDocument(path: string, options?: { mode?: ContextDocMode }) {
    if (path === selectedPath && !options?.mode) return;
    if (isDirty) {
      setPendingAction({ kind: "select", path, mode: options?.mode });
      return;
    }
    applySelect(path, options?.mode);
  }

  function setMode(next: ContextDocMode) {
    if (next === mode) return;
    // Only leaving Edit for Preview can discard something — Preview -> Edit
    // never loses data (AC-8).
    if (next === "preview" && isDirty) {
      setPendingAction({ kind: "mode", mode: next });
      return;
    }
    setModeState(next);
  }

  function requestNavigation(run: () => void) {
    if (isDirty) {
      setPendingAction({ kind: "navigate", run });
      return;
    }
    run();
  }

  function confirmPendingAction() {
    const action = pendingAction;
    if (!action) return;
    setPendingAction(null);
    setDraftOverride(null);
    setConflict(false);
    setSaveOutcome(null);
    if (action.kind === "select") {
      setSelectedPath(action.path);
      setModeState(action.mode ?? "preview");
    } else if (action.kind === "mode") {
      setModeState(action.mode);
    } else {
      action.run();
    }
  }

  function cancelPendingAction() {
    setPendingAction(null);
  }

  function setDraft(content: string) {
    setDraftOverride(content);
  }

  function discardDraft() {
    setDraftOverride(null);
    setSaveOutcome(null);
  }

  function save() {
    if (!repoId || !selectedPath || !document) return;
    saveMutation.mutate(
      { repoId, path: selectedPath, content: draft, expected_revision: document.revision },
      {
        onSuccess: () => {
          setDraftOverride(null);
          setConflict(false);
          setSaveOutcome({ status: "success", message: t("editor.saved") });
          setHasWrittenThisSession(true);
        },
        onError: (err) => {
          // A stale `expected_revision` surfaces as 409 — reject the save,
          // offer exactly one recovery action, no force/merge (AC-9).
          if (err instanceof ApiError && err.status === 409) {
            setConflict(true);
            return;
          }
          setSaveOutcome({
            status: "error",
            message: t("editor.saveFailed", { message: describeError(err) }),
          });
        },
      },
    );
  }

  function reloadFromDisk() {
    setConflict(false);
    setDraftOverride(null);
    setSaveOutcome(null);
    void docQuery.refetch();
  }

  async function createEntry(input: CreateContextEntryBody) {
    if (!repoId) return { ok: false as const, message: describeError(new Error(t("editor.loadError"))) };
    try {
      const result = await createMutation.mutateAsync({ repoId, ...input });
      setHasWrittenThisSession(true);
      // New file opens straight into Edit mode (AC-12); a new folder has no
      // document to select and stays where it was (AC-13/AC-14).
      if (input.kind === "file") {
        applySelect(input.path, "edit");
      }
      return { ok: true as const, result };
    } catch (err) {
      return { ok: false as const, message: describeError(err) };
    }
  }

  async function uploadDocument(file: File) {
    if (!repoId) return { ok: false as const, message: describeError(new Error(t("editor.loadError"))) };
    try {
      const result = await uploadMutation.mutateAsync({ repoId, file });
      setHasWrittenThisSession(true);
      return { ok: true as const, result };
    } catch (err) {
      return { ok: false as const, message: describeError(err) };
    }
  }

  function markSessionReindexed() {
    setHasWrittenThisSession(false);
  }

  return {
    selectedPath,
    document,
    isDocLoading,
    isDocError,
    docErrorMessage,

    mode,
    setMode,

    draft,
    setDraft,
    isDirty,
    discardDraft,

    save,
    isSaving: saveMutation.isPending,
    saveOutcome,

    conflict,
    reloadFromDisk,

    selectDocument,
    requestNavigation,

    pendingAction,
    confirmPendingAction,
    cancelPendingAction,

    hasWrittenThisSession,
    needsReindexConfirm,
    markSessionReindexed,

    createEntry,
    isCreating: createMutation.isPending,

    uploadDocument,
    isUploading: uploadMutation.isPending,
  };
}
