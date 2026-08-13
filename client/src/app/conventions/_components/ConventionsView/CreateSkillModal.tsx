"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Button,
  ErrorState,
  FormField,
  Icon,
  Modal,
  SelectInput,
  Skeleton,
  TextInput,
  Toggle,
} from "@devdigest/ui";
import {
  useConventionSkillDraft,
  useCreateConventionSkill,
} from "../../../../lib/hooks/conventions";
import { useToast } from "../../../../lib/toast";
import { ApiError } from "../../../../lib/api";
import { s } from "./styles";

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
  return slug || "repo-conventions";
}

export function CreateSkillModal({
  repoId,
  repoName,
  onClose,
}: {
  repoId: string;
  repoName: string;
  onClose: () => void;
}) {
  const t = useTranslations("conventions");
  const router = useRouter();
  const toast = useToast();
  const draft = useConventionSkillDraft(repoId, true);
  const create = useCreateConventionSkill(repoId);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [body, setBody] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const lineNumbersRef = React.useRef<HTMLDivElement>(null);

  const filename = `${slugify(name)}.md`;
  const tokenEstimate = Math.ceil(body.length / 4);
  const lineNumbers = React.useMemo(
    () => Array.from({ length: Math.max(body.split("\n").length, 1) }, (_, index) => index + 1),
    [body],
  );

  React.useEffect(() => {
    if (!draft.data) return;
    setName(draft.data.name);
    setDescription(draft.data.description);
    setBody(draft.data.body);
    setEnabled(draft.data.enabled);
  }, [draft.data]);

  const submit = () => {
    create.mutate(
      { name: name.trim(), description: description.trim(), body: body.trim(), enabled },
      {
        onSuccess: (skill) => {
          toast.success(t("modal.created"));
          onClose();
          router.push(`/skills/${skill.id}?tab=config`);
        },
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : t("modal.createFailed")),
      },
    );
  };

  return (
    <Modal
      width={820}
      title={t("modal.title")}
      subtitle={draft.data ? filename : t("modal.loading")}
      onClose={onClose}
      footer={
        <div style={s.modalFooter}>
          <div style={s.saveDestination}>
            <Icon.Link size={13} />
            <span>{t("modal.saveDestination")}</span>
          </div>
          <div style={s.modalActions}>
            <Button kind="ghost" onClick={onClose}>
              {t("modal.cancel")}
            </Button>
            <Button
              kind="primary"
              icon="Sparkles"
              onClick={submit}
              loading={create.isPending}
              disabled={!draft.data || !name.trim() || !body.trim()}
            >
              {t("modal.create")}
            </Button>
          </div>
        </div>
      }
    >
      <div style={s.modalBody}>
        {draft.isLoading && <Skeleton height={360} />}
        {draft.isError && (
          <ErrorState
            body={draft.error instanceof ApiError ? draft.error.message : t("modal.loadFailed")}
            onRetry={() => draft.refetch()}
          />
        )}
        {draft.data && (
          <>
            <div style={s.mergeBanner}>
              <Icon.Sparkles size={15} style={s.mergeBannerIcon} />
              <span>
                {t.rich("modal.mergeBanner", {
                  count: draft.data.candidate_count,
                  repo: repoName,
                  strong: (chunks) => <strong style={s.mergeBannerStrong}>{chunks}</strong>,
                  repoName: (chunks) => <span style={s.mergeBannerRepo}>{chunks}</span>,
                })}
              </span>
            </div>
            <FormField label={t("modal.name")} required>
              <TextInput value={name} onChange={setName} />
            </FormField>
            <FormField label={t("modal.description")}>
              <TextInput value={description} onChange={setDescription} />
            </FormField>
            <div style={s.settingsRow}>
              <FormField label={t("modal.type")}>
                <SelectInput value="convention" options={["convention"]} />
              </FormField>
              <FormField label={t("modal.enabled")}>
                <div style={s.enabledControl}>
                  <Toggle on={enabled} onChange={setEnabled} size={16} />
                  <span style={s.enabledHint}>{t("modal.enabledHint")}</span>
                </div>
              </FormField>
            </div>
            <FormField label={t("modal.body")} required>
              <div style={s.editor}>
                <div style={s.editorHeader}>
                  <Icon.FileText size={14} />
                  <span style={s.editorFilename}>{filename}</span>
                  <span style={s.unsavedBadge}>{t("modal.unsaved")}</span>
                  <span style={s.tokenEstimate}>{t("modal.tokenEstimate", { count: tokenEstimate })}</span>
                </div>
                <div style={s.editorContent}>
                  <div ref={lineNumbersRef} aria-hidden="true" style={s.lineNumbers}>
                    {lineNumbers.map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </div>
                  <textarea
                    aria-label={t("modal.body")}
                    className="mono"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    onScroll={(event) => {
                      if (lineNumbersRef.current) {
                        lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
                      }
                    }}
                    spellCheck={false}
                    style={s.editorTextarea}
                  />
                </div>
              </div>
            </FormField>
          </>
        )}
      </div>
    </Modal>
  );
}
