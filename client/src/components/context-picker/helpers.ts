import type { AttachedContextDoc, ContextSource, SpecFile } from "@devdigest/shared";
import type { ContextDocRow } from "./types";

/** Split a repo-relative document path into its folder and file name for the
 *  row display — "docs/foo/bar.md" -> { folder: "docs/foo", fileName: "bar.md" }. */
export function splitDocPath(path: string): { folder: string; fileName: string } {
  const idx = path.lastIndexOf("/");
  return idx === -1
    ? { folder: "", fileName: path }
    : { folder: path.slice(0, idx), fileName: path.slice(idx + 1) };
}

/** A distinct color per discovered-document source category, so the badges
 *  read at a glance (docs/spec/insights). Reuses this app's existing
 *  semantic color tokens rather than inventing new ones. */
export const SOURCE_BADGE_COLOR: Record<ContextSource, { color: string; bg: string }> = {
  docs: { color: "var(--ok)", bg: "var(--ok-bg)" },
  spec: { color: "var(--accent-text)", bg: "var(--accent-bg)" },
  insights: { color: "var(--warn)", bg: "var(--warn-bg)" },
};

/**
 * Splits the full document set into the attached rows (in persisted order,
 * including any that no longer resolve — AC-9) and every other discovered
 * document not currently attached (alphabetical, for a stable checklist).
 */
export function buildRows(
  documents: SpecFile[],
  attached: AttachedContextDoc[],
): { attachedRows: ContextDocRow[]; unattachedRows: ContextDocRow[] } {
  const documentByPath = new Map(documents.map((d) => [d.path, d]));
  const attachedPaths = new Set(attached.map((a) => a.path));

  const attachedRows: ContextDocRow[] = attached.map((a) => {
    const doc = documentByPath.get(a.path);
    return {
      path: a.path,
      source: a.source,
      tokens: a.tokens ?? doc?.tokens ?? null,
      attached: true,
      resolved: a.resolved,
      usedBy: doc?.used_by ?? null,
    };
  });

  const unattachedRows: ContextDocRow[] = documents
    .filter((d) => !attachedPaths.has(d.path))
    .map((d) => ({
      path: d.path,
      source: d.source,
      tokens: d.tokens ?? null,
      attached: false,
      resolved: true,
      usedBy: d.used_by ?? null,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return { attachedRows, unattachedRows };
}

/** Running token total across the attached set (AC-10) — an unresolved row
 *  contributes 0, since nothing will actually be injected for it. */
export function totalAttachedTokens(attachedRows: ContextDocRow[]): number {
  return attachedRows.reduce((sum, row) => sum + (row.resolved ? (row.tokens ?? 0) : 0), 0);
}

/** Over the soft cap → warning only, never a block (AC-11). */
export function isOverCap(total: number, cap: number): boolean {
  return total > cap;
}
