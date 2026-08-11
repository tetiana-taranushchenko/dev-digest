import type { SkillSource, SkillType } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Skill type → badge colour. Reuses the app's existing semantic CSS vars
 * (severity tokens) so the palette stays consistent with the rest of the
 * dark theme instead of introducing new literals. */
export const SKILL_TYPE_COLOR: Record<SkillType, string> = {
  rubric: "var(--accent)",
  convention: "var(--ok)",
  security: "var(--crit)",
  custom: "var(--warn)",
};

/** Skill source → badge icon (all registered in @devdigest/ui's icon set). */
export const SOURCE_ICON: Record<SkillSource, IconName> = {
  manual: "Edit",
  extracted: "Sparkles",
  community: "Globe",
  imported_url: "Upload",
};
