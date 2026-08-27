import type { AttachedContextDoc } from "@devdigest/shared";

/**
 * Combined direct + enabled-linked-skill attached set, deduped by path
 * (first occurrence wins) — AC-10. Order is this agent's own direct
 * attachments (in persisted order) followed by each enabled linked skill's
 * own attached documents (in that skill's persisted order), in the order
 * the skills themselves are given (the caller passes them already sorted by
 * `agent_skills.order`).
 *
 * Display-only: this combined set must never be fed into
 * `ContextDocPicker`'s `attached` prop, since that prop both drives the
 * interactive checklist AND is exactly what gets reported back via
 * `onChange` on every attach/detach/reorder. Feeding the combined set in
 * would silently persist every inherited-only document as a direct
 * attachment on the next edit (the bug this comment's neighboring fix
 * addresses). Use it only to compute the running total / over-cap warning
 * shown alongside the picker.
 */
export function combineAttached(
  direct: AttachedContextDoc[],
  linkedSkillDocs: AttachedContextDoc[][],
): AttachedContextDoc[] {
  const seen = new Set<string>();
  const combined: AttachedContextDoc[] = [];
  for (const doc of [...direct, ...linkedSkillDocs.flat()]) {
    if (seen.has(doc.path)) continue;
    seen.add(doc.path);
    combined.push(doc);
  }
  return combined;
}

/**
 * Running token total across a (combined or direct) attached set (AC-10) —
 * an unresolved doc contributes 0, since nothing will actually be injected
 * for it. Mirrors `context-picker/helpers.ts`'s `totalAttachedTokens`, kept
 * as a small local duplicate since that module isn't in this task's owned
 * paths and its helpers aren't part of its public surface (`index.ts`).
 */
export function totalTokens(docs: AttachedContextDoc[]): number {
  return docs.reduce((sum, doc) => sum + (doc.resolved ? (doc.tokens ?? 0) : 0), 0);
}
