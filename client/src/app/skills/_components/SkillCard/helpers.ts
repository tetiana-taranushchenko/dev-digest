import type { IconName } from "@devdigest/ui";
import type { Skill, SkillSource, SkillType } from "@devdigest/shared";
import { SKILL_TYPE_COLOR, SOURCE_ICON } from "./constants";

/** Resolve the chip colour for a skill's type (unknown → secondary token). */
export function skillTypeColor(type: SkillType): string {
  return SKILL_TYPE_COLOR[type] ?? "var(--text-secondary)";
}

/** Resolve the badge icon for a skill's source (unknown → generic file icon). */
export function sourceIcon(source: SkillSource): IconName {
  return SOURCE_ICON[source] ?? "File";
}

/** A skill needs vetting when it's disabled AND came from an unvetted source
 * (a URL import or the community catalog) — manual/extracted skills are
 * trusted by construction. The real vetting flow is a later phase; here we
 * only gate the Toggle and surface the "needs vetting" badge. */
export function needsVetting(skill: Pick<Skill, "enabled" | "source">): boolean {
  return !skill.enabled && (skill.source === "imported_url" || skill.source === "community");
}
