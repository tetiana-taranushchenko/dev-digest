import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `skills` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Skill Editor tabs. No `evals` tab — evals is a separate future feature. */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "preview", labelKey: "editor.tabs.preview", icon: "Eye" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];
