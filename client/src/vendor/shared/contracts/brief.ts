import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

/**
 * Discrete, code-derived confidence tier for a derived Intent. Never
 * self-reported by the model (REQ-4) — computed deterministically in
 * `reviewer-core/src/intent/confidence.ts` from which signals were available.
 */
export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

/** The signal kinds the intent classifier can draw on, in priority order. */
export const IntentSignal = z.enum([
  'linked_plan_file',
  'linked_issue',
  'external_doc_url',
  'pr_description',
  'pr_title',
  'commit_messages',
  'changed_paths',
  'diff',
]);
export type IntentSignal = z.infer<typeof IntentSignal>;

/** One signal's availability/fetch outcome, recorded per intent derivation. */
export const IntentSource = z.object({
  signal: IntentSignal,
  fetched: z.boolean(),
  /** Path/URL/identifier the signal was read from, when applicable. */
  ref: z.string().nullish(),
  /** Reason the signal could not be fetched (e.g. `external_url_fetch_not_supported`). */
  error: z.string().nullish(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/** A derived Intent plus the confidence tier, sources, and classifier metadata. */
export const IntentAssessment = Intent.extend({
  confidence: IntentConfidence,
  confidence_reason: z.string(),
  sources: z.array(IntentSource),
  provider: z.string(),
  model: z.string(),
  generated_at: z.string(),
});
export type IntentAssessment = z.infer<typeof IntentAssessment>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

/** Overall blast-radius outcome for a PR. Distinct from `BlastIndexStatus`:
 * this reflects whether the *result* is usable, not the index's own health. */
export const BlastState = z.enum(['ok', 'empty', 'partial', 'degraded']);
export type BlastState = z.infer<typeof BlastState>;

/** Health of the repo-intel index backing a blast-radius read. */
export const BlastIndexStatus = z.enum([
  'full',
  'partial',
  'degraded',
  'failed',
  'missing',
]);
export type BlastIndexStatus = z.infer<typeof BlastIndexStatus>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  /** Declaring file, so a row is self-contained. */
  file: z.string(),
  /** True caller count before the `MAX_CALLERS_PER_SYMBOL` cap. */
  caller_count: z.number().int(),
  /** Capped list — see `caller_count` for the true total. */
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/**
 * One other PR in the same repo that previously touched at least one of this
 * PR's changed files. Reference data only: never part of the blast-radius
 * graph (`changed_symbols`/`downstream`) and never an input to `state`.
 */
export const PriorPr = z.object({
  number: z.number().int(),
  title: z.string(),
  /** ISO timestamp of that PR's last update. `null` when the imported row has
   *  no `updated_at` — the column is nullable (`db/schema/pulls.ts:28`). */
  updated_at: z.string().nullish(),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  /** Other PRs in this repo that touched any of the current PR's changed
   *  files, newest-first, capped at `MAX_PRIOR_PRS`. `[]` = the query ran and
   *  found none (a normal outcome, NOT a degraded signal); absent/`null` = a
   *  server that doesn't compute this. Never influences `state`. */
  prior_prs: z.array(PriorPr).nullish(),
  summary: z.string(),
  state: BlastState,
  /** Machine reason code (e.g. `index_partial`, `no_data`). */
  reason: z.string().nullish(),
  /** Human-readable sentence; non-null whenever `state !== 'ok'`. */
  reason_text: z.string().nullish(),
  /** True if any symbol's caller list hit the `MAX_CALLERS_PER_SYMBOL` cap. */
  truncated: z.boolean(),
  index_status: BlastIndexStatus,
  /** ISO timestamp of when this result was assembled. */
  generated_at: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/** One finding attached to a Smart Diff file, at the exact line it was raised on. */
export const SmartDiffFinding = z.object({
  id: z.string(),
  line: z.number().int(),
  severity: Severity,
});
export type SmartDiffFinding = z.infer<typeof SmartDiffFinding>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  line_findings: z.array(SmartDiffFinding),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
  /**
   * Sum of input+output tokens across each agent's latest review run.
   * `null` when there are no latest reviews yet, or any of them lacks a
   * completed run with known token counts (all-or-nothing — never a partial
   * total presented as authoritative).
   */
  review_tokens: z.number().int().nullable(),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- Brief (one-LLM-call PR brief, sibling to PrBrief — D6) ----
export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Navigation-only citation (D14): `file` is grounded (AC-14), `line` is not. */
export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/** The one-LLM-call Brief (AC-11). Sibling to `PrBrief`, which is untouched (D6). */
export const Brief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskLevel,
  risks: z.array(Risk),          // reuse existing Risk — kind/title/explanation/severity/file_refs
  review_focus: z.array(ReviewFocusItem),
});
export type Brief = z.infer<typeof Brief>;

/** One citation dropped by the grounding gate, WITH its reason — AC-13/AC-14
 *  require the reason to be recorded, not just counted. `label` identifies
 *  what was dropped (a risk title, or a review-focus file) without carrying
 *  model prose wholesale. */
export const BriefDrop = z.object({
  kind: z.enum(['risk', 'risk_citation', 'review_focus']),
  label: z.string(),
  file: z.string().nullish(),
  reason: z.string(),
});
export type BriefDrop = z.infer<typeof BriefDrop>;

/** Response shape for both GET and POST /pulls/:id/brief (AC-18, AC-22, AC-24).
 *  `brief: null` = "no brief for the PR's CURRENT state key" — never a stale
 *  one (AC-19). `cached` means "returned from storage without an LLM call";
 *  it is therefore always `false` when `brief` is null, on GET and POST
 *  alike, and `true` for every served stored Brief. */
export const BriefResult = z.object({
  brief: Brief.nullable(),
  cached: z.boolean(),
  state_key: z.string(),
  intent_available: z.boolean(),
  blast_available: z.boolean(),
  dropped_sections: z.array(z.string()),
  dropped_citations: z.array(BriefDrop),
  generated_at: z.string().nullable(),
  /** Observability fields surfaced to the client (AC-29 data already logged
   *  server-side; these expose the same numbers for the Brief summary's
   *  cost/token display). `nullish` so a stored row from before this field
   *  existed, or an empty/error result, need not populate them. */
  tokens_in: z.number().nullish(),
  tokens_out: z.number().nullish(),
  cost_usd: z.number().nullish(),
});
export type BriefResult = z.infer<typeof BriefResult>;
