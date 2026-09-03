import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/**
 * Skill Editor tabs. `evals`'s `labelKey` doesn't resolve under `skills` —
 * there's no `skills.editor.tabs.evals` key (`messages/en/skills.json`
 * isn't in T11's owned paths, unlike `messages/en/agents.json`, which
 * already had one). `SkillEditor.tsx` special-cases this one entry and
 * resolves its label from the `eval` namespace's existing `page.crumbEvals`
 * key instead; `labelKey` is kept here only for shape-consistency with the
 * rest of `EditorTab` and is never read for this entry.
 */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];
