/** helpers.ts — pure JSON/validation helpers for EvalCaseEditor (T9). No
 *  server calls, no React — safe to unit-test in isolation via the editor's
 *  own test file. */

/** Pretty-prints an `unknown` value for a textarea; empty for null/undefined
 *  or anything that can't be stringified. */
export function stringifyJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

/** AC-25 — the Expected output text must be valid JSON to save. */
export function isValidJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort parse for the Files tab (`input_files`, `z.unknown()` on the
 * contract) — valid JSON parses to its value; anything else is kept as the
 * raw string rather than blocking save (unlike Expected output, this view
 * has no validity gate).
 */
export function parseJsonLenient(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export interface InputMeta {
  title: string;
  body: string;
}

/** Reads the PR meta tab's structured `{title, body}` shape back out of the
 *  `input_meta` unknown field (seed or a loaded case). */
export function parseInputMeta(raw: unknown): InputMeta {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return {
      title: typeof r.title === "string" ? r.title : "",
      body: typeof r.body === "string" ? r.body : "",
    };
  }
  return { title: "", body: "" };
}

/** `null` when both fields are blank so an untouched PR meta tab persists as
 *  `null` rather than `{ title: "", body: "" }`. */
export function buildInputMeta(title: string, body: string): InputMeta | null {
  if (!title.trim() && !body.trim()) return null;
  return { title, body };
}

/** AC-30 — Save is blocked while no owner is chosen. */
export function isOwnerMissing(ownerId: string): boolean {
  return ownerId.trim().length === 0;
}

/** Mirrors the server's pass rule (AC-11/AC-40): exactly recall===1 &&
 *  precision===1. `EvalRun` itself carries no `pass` field. */
export function computeRunPassed(result: { recall: number; precision: number }): boolean {
  return result.recall === 1 && result.precision === 1;
}
