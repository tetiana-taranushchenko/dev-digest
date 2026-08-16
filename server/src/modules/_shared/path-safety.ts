import { isAbsolute, relative, sep } from 'node:path';

/**
 * Path-containment safety check shared by any module that reads an in-repo
 * file at a path derived from untrusted input (LLM output, PR body, repo
 * intel). Security-relevant — keep exactly one copy so hardening lands
 * everywhere at once.
 */
export function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

/** Normalize a repo-relative path and reject absolute/traversal variants. */
export function safeRepoPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || isAbsolute(trimmed) || trimmed.includes('\\')) return null;
  const segments = trimmed.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return segments.join('/');
}
