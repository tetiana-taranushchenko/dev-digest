import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import type { SkillRow } from '../../db/rows.js';

/**
 * Pure helpers for the skills module — DB row ⇄ DTO mapping and the
 * content-version-bump rule. No I/O; behaviour-identical logic to the agents
 * module's helpers, adapted to skills' body-only version rule.
 */

/** Map a persisted skill row to the public `Skill` DTO. */
export function toSkillDto(row: SkillRow): Skill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type as SkillType,
    source: row.source as SkillSource,
    body: row.body,
    enabled: row.enabled,
    version: row.version,
    evidence_files: row.evidenceFiles ?? null,
  };
}

/** A single `skill_versions` snapshot, mapped to its public shape. */
export interface SkillVersionDto {
  skill_id: string;
  version: number;
  body: string;
  /** Derived change summary vs. the previous version — not a stored column. */
  summary: string;
  created_at: string;
}

/** Only `body` can trigger a version bump — name/description/type/enabled do not. */
export interface ContentChangePatch {
  body?: string;
}

/**
 * True when a patch changes the skill's body relative to the existing row — a
 * content change bumps the version and snapshots skill_versions. Editing
 * name/description/type, or toggling `enabled`, never bumps the version.
 */
export function isContentChange(
  existing: Pick<SkillRow, 'body'>,
  patch: ContentChangePatch,
): boolean {
  return patch.body !== undefined && patch.body !== existing.body;
}

function lineMultiset(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split('\n')) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
}

/**
 * Derived `"+N / −M lines"` change summary between two version bodies. This is
 * a coarse line-multiset diff (counts how many line occurrences were added vs.
 * removed), not a true LCS diff — good enough for a version-history label
 * without needing a diff library or a stored summary column.
 */
export function changeSummary(prevBody: string | undefined, nextBody: string): string {
  if (prevBody === undefined) return 'Initial version';
  if (prevBody === nextBody) return 'No changes';

  const prevCounts = lineMultiset(prevBody);
  const nextCounts = lineMultiset(nextBody);
  let added = 0;
  let removed = 0;
  const keys = new Set([...prevCounts.keys(), ...nextCounts.keys()]);
  for (const key of keys) {
    const before = prevCounts.get(key) ?? 0;
    const after = nextCounts.get(key) ?? 0;
    if (after > before) added += after - before;
    if (before > after) removed += before - after;
  }
  return `+${added} / −${removed} lines`;
}

/** URL/filename-safe slug for a skill's display filename (e.g. `{slug}.md`). */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return slug || 'skill';
}
