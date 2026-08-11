import type { Skill } from "@devdigest/shared";

/** Case-insensitive filter over a skill's name. */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((sk) => sk.name.toLowerCase().includes(q));
}
