import type { SkillType } from "@devdigest/shared";

/** Skill types selectable in the Config tab, in display order. */
export const SKILL_TYPE_VALUES: readonly SkillType[] = ["rubric", "convention", "security", "custom"];

/** Skill sources that are untrusted until a human explicitly vets them —
 *  mirrors `UNTRUSTED_SOURCES` in server/src/modules/skills/constants.ts. */
export const UNTRUSTED_SOURCES = ["imported_url", "community"] as const;
