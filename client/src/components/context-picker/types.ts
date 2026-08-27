import type { AttachedContextDoc, ContextSource, SpecFile } from "@devdigest/shared";

/**
 * ContextDocPicker — shared attach UI (T12, `docs/plans/project-context.md`).
 * Two consumers: the Agent Editor Context tab (T15) and the Skill Editor
 * context section (T16), promoted here per `client/INSIGHTS.md` (2026-08-04,
 * "Formatters used by >1 component tree belong in a shared home").
 */
export interface ContextDocPickerProps {
  /** The active repo — threaded through to the Preview drawer so it can fetch
   *  a document's real content on demand (`GET /repos/:id/context/document`,
   *  the authoring feature's read endpoint — safe for any discovered
   *  document, not just a writable one). */
  repoId: string | null | undefined;
  /** Every markdown document discovered for the repo (the checklist source —
   *  from `useContextFiles(repoId).data.files`). */
  documents: SpecFile[];
  /** This agent's/skill's currently attached documents, in persisted order.
   *  Server-resolved against the current clone — includes any path that no
   *  longer resolves (AC-9: shown as missing, never silently dropped). For
   *  the agent case, the caller (T15) is responsible for pre-combining
   *  direct + enabled-linked-skill attachments, deduped by path (AC-10);
   *  this component only renders whatever ordered set it's given. */
  attached: AttachedContextDoc[];
  /** Fires with the next ordered, deduped list of repo-relative paths on
   *  every attach/detach/reorder. The caller persists it (paths only) via
   *  its own mutation against `SetContextPathsBody`. */
  onChange: (paths: string[]) => void;
  /**
   * Soft token-budget warning threshold (AC-11). REQUIRED — the
   * `ContextListing`/`AttachedContextDoc` contract doesn't expose the
   * server's `CONTEXT_TOKEN_CAP` yet (see `constants.ts` in this directory),
   * so the caller must source it until the contract does.
   */
  tokenCap: number;
  /** Renders the map-reduce cost-repeats note (AC-11) — true when the owning
   *  agent's `strategy === "map-reduce"`. Skill callers (T16) never pass this. */
  mapReduce?: boolean;
  /** The `documents`/`attached` data is still loading. */
  loading?: boolean;
  /** The `documents`/`attached` data failed to load. */
  loadError?: boolean;
  /** Suppresses the picker's own internal "N tokens total" summary bar
   *  (token total text + over-cap badge/hint) when the consumer renders its
   *  own — necessarily more complete — summary instead (e.g. the Agent
   *  Editor Context tab's combined direct+inherited total, AC-10). Defaults
   *  to `false`/undefined, preserving the picker's own summary bar for
   *  single-set consumers like the Skill Editor's Context tab, whose total
   *  isn't combined with anything else. Never affects the checklist,
   *  attach/detach, reorder, or preview drawer. */
  hideSummary?: boolean;
  /** Disables every attach/detach/reorder affordance (e.g. while a mutation
   *  targeting a different set is already in flight). */
  disabled?: boolean;
}

/** One row's view model, resolved against both `documents` and `attached`. */
export interface ContextDocRow {
  path: string;
  source: ContextSource | null;
  tokens: number | null;
  attached: boolean;
  /** False for an attached path that no longer resolves in the repo (AC-9). */
  resolved: boolean;
  usedBy: number | null;
}
