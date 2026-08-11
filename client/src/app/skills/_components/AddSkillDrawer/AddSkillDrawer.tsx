"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Modal, Tabs } from "@devdigest/ui";
import { CreateTab } from "./_components/CreateTab";
import { FileTab } from "./_components/FileTab";
import { UrlTab } from "./_components/UrlTab";
import { CommunityTab } from "./_components/CommunityTab";

export type AddSkillDrawerTab = "create" | "file" | "url" | "community";

/** "Add Skill" — a centered MODAL with 4 tabs: Create / From file / Import
 *  from URL / Community. Opened via the "+ Add Skill" dropdown menu (4 items,
 *  one per tab) on both the Skills list and the Skill Editor page — the menu
 *  item just picks which tab the modal opens on; all 4 stay reachable inside
 *  the modal via the tab bar itself. Every import path (file/URL/community)
 *  lands the new skill disabled + needs-vetting (untrusted source); Create
 *  lands enabled immediately (source manual, directly authored). */
export function AddSkillDrawer({
  initialTab = "file",
  onClose,
}: {
  initialTab?: AddSkillDrawerTab;
  onClose: () => void;
}) {
  const t = useTranslations("skills");
  const [tab, setTab] = React.useState<AddSkillDrawerTab>(initialTab);

  // Modal (vendored, do-not-edit) wraps `children` in the only scrollable
  // region; `title`/`subtitle` sit in its fixed, non-scrolling header. Putting
  // the Tabs bar in `subtitle` keeps it pinned while tall tab content (e.g.
  // the body textarea) scrolls independently below it — without touching Modal.
  return (
    <Modal
      title={t("drawer.title")}
      subtitle={
        <div style={{ marginTop: 8 }}>
          <Tabs
            tabs={[
              { key: "file", label: t("drawer.tabs.file") },
              { key: "url", label: t("drawer.tabs.url") },
              { key: "community", label: t("drawer.tabs.community") },
              { key: "create", label: t("drawer.tabs.create") },
            ]}
            value={tab}
            onChange={(k) => setTab(k as AddSkillDrawerTab)}
            pad="0"
          />
        </div>
      }
      onClose={onClose}
      width={560}
    >
      <div style={{ padding: "20px 24px 24px" }}>
        {tab === "create" && <CreateTab onImported={onClose} />}
        {tab === "file" && <FileTab onImported={onClose} />}
        {tab === "url" && <UrlTab onImported={onClose} />}
        {tab === "community" && <CommunityTab onImported={onClose} />}
      </div>
    </Modal>
  );
}
