/* /context — Project Context authoring (T11,
   `docs/plans/project-context-authoring.md`). The shell + left pane of the
   two-pane master-detail screen: the flat, repo-wide document list (today's
   row metadata — source category, token estimate, used-by, AC-1) stays
   visible with the selected row visually marked (AC-2) alongside the detail
   pane (`DocumentDetail`, T10), which renders whatever `useContextAuthoring`
   (T9) — the single state machine behind this whole screen — currently
   holds. Toolbar: New file, New folder, Upload (a real file input behind a
   button, no drag-and-drop — AC-15) and Refresh/Re-index, each an icon-only
   button with an accessible name. Status line: documents indexed + combined
   token estimate + last refreshed, all derived from the listing the server
   returned — no chunk-count metric DevDigest doesn't compute (AC-25, AC-26)
   and no COVERAGE badge anywhere (AC-27). Dialogs: `NamePromptDialog` (new, this task) for New
   file/New folder, and the vendored `ConfirmDialog` reused for both the
   unsaved-changes gate (AC-8) and the Re-index confirmation that names the
   consequence — uncommitted clone edits will be discarded — and must not
   start the resync unless confirmed (AC-29). With no clone
   (`index.unavailable_reason` set) every authoring action is disabled with
   the reason shown, not failed at write time (AC-22). */
"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, IconBtn, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { RepoNotFound } from "../../../../components/repo-not-found";
import { ConfirmDialog } from "../../../../components/ConfirmDialog";
import { useActiveRepo } from "../../../../lib/repo-context";
import { useContextFiles, useReindexContext } from "../../../../lib/hooks/core";
import { ApiError } from "../../../../lib/api";
import { DocumentDetail } from "../DocumentDetail";
import { DocumentList } from "../DocumentList";
import { NamePromptDialog } from "../dialogs";
import { useContextAuthoring } from "./useContextAuthoring";
import { combinedTokenEstimate, formatRefreshedAt, isValidEntryName, sortedDocs } from "./helpers";
import { s } from "./styles";

export function ContextView() {
  const t = useTranslations("context");
  const tCommon = useTranslations("common");
  const { repoId, reposLoaded } = useActiveRepo();
  const query = useContextFiles(repoId);
  const reindex = useReindexContext();
  const authoring = useContextAuthoring(repoId);

  const [createKind, setCreateKind] = useState<"file" | "folder" | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [folderNote, setFolderNote] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [reindexConfirmOpen, setReindexConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AC-8: warn on navigating away (tab close, refresh, typed URL, browser
  // back/forward) while the editor holds unsaved changes — the one part of
  // "navigate away" that `pendingAction`'s in-app confirm dialog can't cover,
  // since the page itself is about to unload. This is a real side effect
  // (subscribing to a `window` event), not derived state, so a `useEffect`
  // here is legitimate even though `useContextAuthoring` (T9) forbids it for
  // its own derived values. Re-registered whenever `isDirty` flips so the
  // listener is only live when there's actually something to lose; there is
  // no in-app `<Link>` inside this plan's owned paths (`client/src/app/
  // context/**`) that leaves `/context`, so `requestNavigation` — built for
  // gating exactly that — currently has no matching call site and stays
  // reserved for if one is added later.
  useEffect(() => {
    if (!authoring.isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [authoring.isDirty]);

  const index = query.data?.index;
  const files = sortedDocs(query.data?.files ?? []);
  const unavailableReason = index?.unavailable_reason ?? null;
  // AC-22: with no clone, every authoring action is disabled and the reason
  // is shown, rather than failing later at write time.
  const authoringDisabled = !repoId || !!unavailableReason;

  const runReindex = () => {
    if (!repoId) return;
    reindex.mutate(repoId, { onSuccess: () => authoring.markSessionReindexed() });
  };

  const onReindexClick = () => {
    // AC-29: the resync must not start unless confirmed whenever the
    // session holds unsaved edits or has written a document since refresh.
    if (authoring.needsReindexConfirm) {
      setReindexConfirmOpen(true);
      return;
    }
    runReindex();
  };

  const openCreateDialog = (kind: "file" | "folder") => {
    setCreateError(null);
    setFolderNote(null);
    setCreateKind(kind);
  };

  const submitCreate = async (rawName: string) => {
    if (!createKind) return;
    const trimmed = rawName.trim();
    // New file just needs a base name — the ".md" extension is implicit
    // (AC-12); a name the user already typed with ".md" is left as-is.
    const path =
      createKind === "file" && !trimmed.toLowerCase().endsWith(".md") ? `${trimmed}.md` : trimmed;

    if (!isValidEntryName(path, createKind)) {
      setCreateError(t("create.invalidName"));
      return;
    }

    setCreateError(null);
    const outcome = await authoring.createEntry({ kind: createKind, path });
    if (!outcome.ok) {
      setCreateError(outcome.message);
      return;
    }

    setCreateKind(null);
    // AC-14/Recommendation 5: an empty folder won't appear in the list until
    // it contains a document — say so inline, not in a second dialog.
    if (createKind === "folder") {
      setFolderNote(outcome.result.path);
    }
  };

  const onUploadClick = () => fileInputRef.current?.click();

  const onFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so selecting the same file again still fires a change event.
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    const outcome = await authoring.uploadDocument(file);
    if (!outcome.ok) setUploadError(outcome.message);
  };

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <main style={s.page}>
        <header style={s.header}>
          <div style={s.headerText}>
            <h1 style={s.h1}>{t("title")}</h1>
          </div>
        </header>

        {folderNote && (
          <div style={s.inlineNote}>
            <Icon.Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ flex: 1 }}>{t("folderInvisibleNote")}</span>
            <IconBtn icon="X" label={tCommon("actions.close")} size={22} onClick={() => setFolderNote(null)} />
          </div>
        )}
        {uploadError && (
          <div role="alert" style={{ ...s.inlineNote, ...s.inlineNoteError }}>
            <Icon.AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1, color: "var(--crit)" }} />
            <span style={{ flex: 1 }}>{t("upload.failed", { message: uploadError })}</span>
            <IconBtn icon="X" label={tCommon("actions.close")} size={22} onClick={() => setUploadError(null)} />
          </div>
        )}

        {!reposLoaded && <Skeleton height={240} />}
        {reposLoaded && !repoId && <RepoNotFound />}
        {repoId && query.isLoading && <Skeleton height={240} />}
        {repoId && query.isError && (
          <ErrorState
            body={query.error instanceof ApiError ? query.error.message : t("loadError")}
            onRetry={() => query.refetch()}
          />
        )}
        {repoId && !query.isLoading && !query.isError && unavailableReason && (
          <div role="alert" style={s.unavailable}>
            <Icon.AlertTriangle size={16} style={s.unavailableIcon} />
            <span>
              <span style={s.unavailableStrong}>{t("loadError")}</span> — {unavailableReason}
            </span>
          </div>
        )}
        {repoId &&
          !query.isLoading &&
          !query.isError &&
          !unavailableReason &&
          files.length === 0 && (
            <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
          )}
        {repoId && !unavailableReason && files.length > 0 && (
          <div style={s.body}>
            <div style={s.listPane}>
              {repoId && (
                <div style={s.listToolbar}>
                  <Button
                    kind="secondary"
                    icon="File"
                    aria-label={t("toolbar.newFile")}
                    title={t("toolbar.newFile")}
                    disabled={authoringDisabled}
                    onClick={() => openCreateDialog("file")}
                  />
                  <Button
                    kind="secondary"
                    icon="Folder"
                    aria-label={t("toolbar.newFolder")}
                    title={t("toolbar.newFolder")}
                    disabled={authoringDisabled}
                    onClick={() => openCreateDialog("folder")}
                  />
                  <Button
                    kind="secondary"
                    icon="Upload"
                    aria-label={t("toolbar.upload")}
                    title={t("toolbar.upload")}
                    disabled={authoringDisabled || authoring.isUploading}
                    loading={authoring.isUploading}
                    onClick={onUploadClick}
                  />
                  {/* Real file input behind the Upload button — no drag-and-drop (AC-15). */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md"
                    style={s.hiddenInput}
                    onChange={onFileSelected}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  <Button
                    kind="secondary"
                    icon="RefreshCw"
                    aria-label={t("toolbar.refresh")}
                    title={t("toolbar.refresh")}
                    loading={reindex.isPending}
                    onClick={onReindexClick}
                  />
                </div>
              )}
              <div style={s.listScroll}>
                <DocumentList files={files} selectedPath={authoring.selectedPath} onSelect={authoring.selectDocument} />
              </div>
              {index && (
                <div style={s.freshness}>
                  <Icon.Clock size={12} />
                  <span>{t("status.documents", { count: index.doc_count })}</span>
                  <span>· {t("status.tokens", { tokens: combinedTokenEstimate(files) })}</span>
                  {index.refreshed_at && (
                    <span>· {t("status.refreshed", { when: formatRefreshedAt(index.refreshed_at) })}</span>
                  )}
                </div>
              )}
            </div>
            <div style={s.detailPane}>
              <DocumentDetail {...authoring} />
            </div>
          </div>
        )}
      </main>

      {createKind && (
        <NamePromptDialog
          kind={createKind}
          submitting={authoring.isCreating}
          error={createError}
          onSubmit={submitCreate}
          onCancel={() => setCreateKind(null)}
        />
      )}

      {/* Unsaved-changes gate (AC-8) — shared by selecting another document
          and switching the detail pane back to Preview; both funnel through
          `useContextAuthoring`'s single `pendingAction`. */}
      {authoring.pendingAction && (
        <ConfirmDialog
          title={t("unsavedConfirm.title")}
          message={t("unsavedConfirm.body")}
          confirmLabel={t("unsavedConfirm.confirm")}
          cancelLabel={tCommon("actions.cancel")}
          danger
          onConfirm={authoring.confirmPendingAction}
          onCancel={authoring.cancelPendingAction}
        />
      )}

      {/* Re-index confirmation naming the consequence — uncommitted clone
          edits will be discarded — and must not start the resync unless
          confirmed (AC-29). */}
      {reindexConfirmOpen && (
        <ConfirmDialog
          title={t("reindexConfirm.title")}
          message={t("reindexConfirm.body")}
          confirmLabel={t("reindexConfirm.confirm")}
          cancelLabel={tCommon("actions.cancel")}
          danger
          onConfirm={() => {
            setReindexConfirmOpen(false);
            runReindex();
          }}
          onCancel={() => setReindexConfirmOpen(false)}
        />
      )}
    </AppShell>
  );
}
