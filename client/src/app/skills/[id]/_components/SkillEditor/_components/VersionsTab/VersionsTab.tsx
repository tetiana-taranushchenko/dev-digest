"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Modal, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillVersions, useRestoreSkillVersion } from "../../../../../../../lib/hooks/skills";
import { useToast } from "../../../../../../../lib/toast";
import { diffLines } from "./helpers";
import { s } from "./styles";

/** Versions tab — body-version history (newest first). Every save on the
 *  Config tab that changes the body snapshots into skill_versions server-side
 *  (see server/src/modules/skills/repository.ts's snapshotVersion); this tab
 *  is the read/restore/diff surface over that history. Restore appends a NEW
 *  top version rather than rewriting history (see helpers.ts / server repo). */
export function VersionsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const restore = useRestoreSkillVersion();
  const [diffVersion, setDiffVersion] = React.useState<number | null>(null);

  if (isLoading || !versions) {
    return (
      <div style={s.wrap}>
        <Skeleton height={18} width={200} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </div>
    );
  }

  const diffTarget = diffVersion != null ? versions.find((v) => v.version === diffVersion) : undefined;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("versions.title")}</h2>
        <Badge color="var(--text-secondary)">{t("versions.count", { count: versions.length })}</Badge>
      </div>

      <div style={s.list}>
        {versions.map((v) => {
          const isCurrent = v.version === skill.version;
          return (
            <div key={v.version} style={s.row}>
              <Badge color="var(--accent)" mono>
                {t("preview.version", { version: v.version })}
              </Badge>
              <div style={s.rowBody}>
                <div style={s.summary}>{v.summary}</div>
                <div style={s.date}>{v.created_at.slice(0, 10)}</div>
              </div>
              {isCurrent ? (
                <Badge color="var(--ok)">{t("versions.current")}</Badge>
              ) : (
                <div style={s.rowActions}>
                  <Button kind="secondary" size="sm" icon="FileText" onClick={() => setDiffVersion(v.version)}>
                    {t("versions.diff")}
                  </Button>
                  <Button
                    kind="secondary"
                    size="sm"
                    icon="RefreshCw"
                    disabled={restore.isPending}
                    onClick={() => {
                      if (!window.confirm(t("versions.restoreConfirm", { version: v.version }))) return;
                      restore.mutate(
                        { id: skill.id, version: v.version },
                        {
                          onSuccess: (data) =>
                            toast.success(t("versions.restored", { version: data.version })),
                        },
                      );
                    }}
                  >
                    {t("versions.restore")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={s.footer}>{t("versions.footerNote")}</div>

      {diffTarget && (
        <Modal
          title={t("versions.diffTitle", { version: diffTarget.version })}
          onClose={() => setDiffVersion(null)}
        >
          <div style={s.diffBody}>
            {diffLines(diffTarget.body, skill.body).map((line, idx) => (
              <div
                key={idx}
                style={line.type === "added" ? s.diffAdded : line.type === "removed" ? s.diffRemoved : s.diffSame}
              >
                {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}
                {line.text}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
