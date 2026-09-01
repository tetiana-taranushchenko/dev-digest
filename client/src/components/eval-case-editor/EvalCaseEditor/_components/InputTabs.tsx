"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Markdown, Tabs, TextInput, Textarea } from "@devdigest/ui";
import type { InputTabKey } from "../constants";
import { s } from "../styles";

/**
 * InputTabs — the Diff / Files / PR meta views of the Input section (AC-24).
 * Diff and Files are raw text (mono textareas over `input_diff`/`input_files`
 * — Files is `z.unknown()` on the contract, best-effort JSON on save). PR
 * meta is the structured `{title, body}` shape the pre-seeded `titleLabel`/
 * `bodyLabel`/`preview` messages were scaffolded for, with a Preview toggle
 * that renders the body as markdown.
 */
export function InputTabs({
  activeTab,
  onTabChange,
  diff,
  onDiffChange,
  filesText,
  onFilesChange,
  metaTitle,
  onMetaTitleChange,
  metaBody,
  onMetaBodyChange,
  metaPreview,
  onMetaPreviewToggle,
}: {
  activeTab: InputTabKey;
  onTabChange: (tab: InputTabKey) => void;
  diff: string;
  onDiffChange: (v: string) => void;
  filesText: string;
  onFilesChange: (v: string) => void;
  metaTitle: string;
  onMetaTitleChange: (v: string) => void;
  metaBody: string;
  onMetaBodyChange: (v: string) => void;
  metaPreview: boolean;
  onMetaPreviewToggle: () => void;
}) {
  const t = useTranslations("eval");
  const tabs = [
    { key: "diff", label: t("caseEditor.tabs.diff") },
    { key: "files", label: t("caseEditor.tabs.files") },
    { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
  ];

  return (
    <div style={s.inputTabsWrap}>
      <Tabs tabs={tabs} value={activeTab} onChange={(k) => onTabChange(k as InputTabKey)} pad="0 12px" />
      <div style={s.tabBody}>
        {activeTab === "diff" && (
          <Textarea
            value={diff}
            onChange={onDiffChange}
            rows={14}
            mono
            placeholder={t("caseEditor.diffPlaceholder")}
          />
        )}
        {activeTab === "files" && <Textarea value={filesText} onChange={onFilesChange} rows={14} mono />}
        {activeTab === "prMeta" && (
          <div style={s.metaWrap}>
            <FormField label={t("caseEditor.titleLabel")}>
              <TextInput
                value={metaTitle}
                onChange={onMetaTitleChange}
                placeholder={t("caseEditor.titlePlaceholder")}
              />
            </FormField>
            <FormField
              label={t("caseEditor.bodyLabel")}
              right={
                <Button kind="ghost" size="sm" onClick={onMetaPreviewToggle}>
                  {t("caseEditor.preview")}
                </Button>
              }
            >
              {metaPreview ? (
                <div style={s.metaPreview}>
                  <Markdown>{metaBody}</Markdown>
                </div>
              ) : (
                <Textarea
                  value={metaBody}
                  onChange={onMetaBodyChange}
                  rows={10}
                  placeholder={t("caseEditor.bodyPlaceholder")}
                />
              )}
            </FormField>
          </div>
        )}
      </div>
    </div>
  );
}
