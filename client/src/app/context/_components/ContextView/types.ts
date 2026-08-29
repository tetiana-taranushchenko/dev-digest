/* types.ts — prop/result shapes for the Project Context authoring state
   machine (T9, `docs/plans/project-context-authoring.md`). No JSX, no
   runtime logic — see `useContextAuthoring.ts` for the hook that produces
   `UseContextAuthoringResult`, and `DocumentDetail` (T10) for the consumer
   of `DocumentDetailProps`. */

import type {
  ContextDocument,
  CreateContextEntryBody,
  CreateContextEntryResult,
} from "@devdigest/shared";

/** Preview/Edit is a two-state toggle on the same document (AC-5). */
export type ContextDocMode = "preview" | "edit";

/** Save's outcome, rendered as an inline `role="status"` line in the detail
 *  pane rather than a toast — this repo has no toast system (AC-6,
 *  Recommendation 3 in the plan). */
export interface SaveOutcome {
  status: "success" | "error";
  message: string;
}

/** Result of a create/upload attempt — never thrown, so a caller (e.g. the
 *  New file/folder name-prompt dialog) can await it and decide whether to
 *  close the dialog or show the failure inline without a try/catch. */
export type ActionOutcome<TResult> =
  | { ok: true; result: TResult }
  | { ok: false; message: string };

/** An action deferred behind the unsaved-changes confirmation gate (AC-8):
 *  selecting a different document, switching to Preview, or navigating away
 *  while the editor holds unsaved changes. Resolved by
 *  `confirmPendingAction()` (discards the draft, then performs the action)
 *  or `cancelPendingAction()` (keeps the draft, does nothing). */
export type PendingContextAction =
  | { kind: "select"; path: string; mode?: ContextDocMode }
  | { kind: "mode"; mode: ContextDocMode }
  | { kind: "navigate"; run: () => void };

/** Props the detail pane (`DocumentDetail`, T10) consumes — a slice of
 *  `UseContextAuthoringResult` covering everything about the *selected*
 *  document: its loaded state, the Preview/Edit toggle, the draft/dirty/
 *  conflict/save machinery. Excludes list- and toolbar-scoped concerns
 *  (`selectDocument`, `createEntry`, `uploadDocument`, `pendingAction`),
 *  which the shell (`ContextView`, T11) owns and threads through separately. */
export interface DocumentDetailProps {
  selectedPath: string | null;
  document: ContextDocument | undefined;
  isDocLoading: boolean;
  isDocError: boolean;
  docErrorMessage: string | null;

  mode: ContextDocMode;
  setMode: (mode: ContextDocMode) => void;

  draft: string;
  setDraft: (content: string) => void;
  isDirty: boolean;
  discardDraft: () => void;

  save: () => void;
  isSaving: boolean;
  saveOutcome: SaveOutcome | null;

  conflict: boolean;
  reloadFromDisk: () => void;
}

/** Full return shape of `useContextAuthoring` — the single state machine
 *  behind the repo-scoped Project Context authoring screen (T9). `ContextView` (T11)
 *  calls the hook once and passes `DocumentDetailProps`-shaped slices down
 *  to `DocumentDetail` (T10); the rest (list selection, toolbar actions,
 *  the confirm dialogs) stays at the shell level. */
export interface UseContextAuthoringResult extends DocumentDetailProps {
  /** Selects a document. Gated behind `pendingAction` when the editor
   *  currently holds unsaved changes (AC-8). `options.mode` lets a caller
   *  (e.g. New file) open the newly selected document straight into Edit
   *  (AC-12) instead of the default Preview. */
  selectDocument: (path: string, options?: { mode?: ContextDocMode }) => void;

  /** Gate an arbitrary navigate-away action behind the same unsaved-changes
   *  confirmation as `selectDocument`/`setMode` (AC-8). */
  requestNavigation: (run: () => void) => void;

  pendingAction: PendingContextAction | null;
  /** Discards the draft and performs the deferred action. */
  confirmPendingAction: () => void;
  /** Keeps the draft; the deferred action is dropped, not performed. */
  cancelPendingAction: () => void;

  /** Set by any successful save/create/upload this session; cleared by
   *  `markSessionReindexed()` after a successful re-index. Combined with
   *  `isDirty`, this is what a Re-index confirmation should be gated on
   *  (AC-29) — exposed pre-combined as `needsReindexConfirm` so the caller
   *  doesn't have to re-derive the `||`. */
  hasWrittenThisSession: boolean;
  needsReindexConfirm: boolean;
  markSessionReindexed: () => void;

  createEntry: (
    input: CreateContextEntryBody,
  ) => Promise<ActionOutcome<CreateContextEntryResult>>;
  isCreating: boolean;

  uploadDocument: (file: File) => Promise<ActionOutcome<CreateContextEntryResult>>;
  isUploading: boolean;
}
