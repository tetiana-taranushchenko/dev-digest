import type { SpecFile } from "@devdigest/shared";

/** Split a repo-relative document path into its folder and file name for the
 *  listing (AC-1) — "docs/foo/bar.md" -> { folder: "docs/foo", fileName: "bar.md" }.
 *  A top-level file (no "/") has no folder. */
export function splitDocPath(path: string): { folder: string; fileName: string } {
  const idx = path.lastIndexOf("/");
  return idx === -1
    ? { folder: "", fileName: path }
    : { folder: path.slice(0, idx), fileName: path.slice(idx + 1) };
}

/** Documents sorted alphabetically by path for a stable listing. */
export function sortedDocs(files: SpecFile[]): SpecFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}

/** Absolute-timestamp display for the index-freshness line — same
 *  `toLocaleString()` fallback pattern used elsewhere for ISO dates
 *  (e.g. `ReviewRunAccordion.tsx`, `CommentCard.tsx`). */
export function formatRefreshedAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Combined token estimate for the status line (AC-25/G-5) — the sum of
 *  every discovered document's estimated token count, all derived from the
 *  listing the server returned (never a second cost/tokenizer call). */
export function combinedTokenEstimate(files: SpecFile[]): number {
  return files.reduce((sum, file) => sum + (file.tokens ?? 0), 0);
}

/** Max characters per path segment — mirrors the server's
 *  `NAME_SEGMENT_MAX` (`server/src/modules/context/constants.ts`), kept as a
 *  client-side precheck so an obviously-invalid name (AC-18) is rejected
 *  before a round trip, not as a replacement for server-side validation. */
const NAME_SEGMENT_MAX = 100;
const NAME_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/** Client-side precheck for a New file/New folder name (AC-12, AC-13,
 *  AC-18) — every segment must be non-empty, match the allowed character
 *  set, not start with a dot, and stay within the length cap; a file name's
 *  final segment must end in ".md". This is a fast-feedback mirror of
 *  `write-safety.ts#validateEntryPath`, not a substitute for it — the
 *  server re-validates and is the source of truth for containment. */
export function isValidEntryName(raw: string, kind: "file" | "folder"): boolean {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.endsWith("/")) return false;
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  const validSegments = segments.every(
    (segment) =>
      segment.length > 0 &&
      segment.length <= NAME_SEGMENT_MAX &&
      !segment.startsWith(".") &&
      NAME_SEGMENT_RE.test(segment),
  );
  if (!validSegments) return false;
  return kind === "folder" || trimmed.toLowerCase().endsWith(".md");
}
