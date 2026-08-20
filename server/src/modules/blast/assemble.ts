import type { BlastIndexStatus, BlastRadius, BlastState, DownstreamImpact, PriorPr } from '@devdigest/shared';
import { MAX_CALLERS_PER_SYMBOL } from '../repo-intel/constants.js';
import type { BlastCallerRow, BlastResult, IndexState, ReverseImpactResult } from '../repo-intel/types.js';

/**
 * Blast Radius — pure assembler (`assemble.ts`, T4).
 *
 * Turns the facade-level `BlastResult` + `IndexState` + `ReverseImpactResult`
 * into the `BlastRadius` contract shape. No I/O, no `Container` — every input
 * is already resolved by `blast/service.ts` (T5). Rule numbering below mirrors
 * `docs/plans/blast-radius.md`'s "T4 notes" section exactly; keep both in sync.
 *
 * Tie-break note (Risks & Mitigations in the plan): `BlastCallerRow.viaSymbol`
 * carries only a symbol *name*, not a file — so two changed files that declare
 * a same-named symbol collapse into a single `downstream` row. `file` on that
 * row is resolved as the lexicographically smallest declaring file for the
 * name (rule 3); acceptable for v1, documented here rather than silently.
 *
 * Prior PRs (`docs/plans/blast-radius-prior-prs.md`, T3): `input.priorPrs` is
 * reference data only — other PRs in the same repo that previously touched
 * one of the current PR's changed files. It is never part of the blast-radius
 * graph (`changed_symbols`/`downstream`) and is never read by rules 1-6 of the
 * state machine below (REQ-5). `prior_prs` is computed last, strictly AFTER
 * `state`/`reason`/`truncated`/`index_status` are already decided, so it can
 * never influence them — not even accidentally.
 */

/** Human sentences for every machine `reason` code the state machine below can produce. */
const REASON_TEXT: Record<string, string> = {
  flag_off: 'Blast radius indexing is turned off for this repo.',
  index_failed: 'The repo index failed to build, so blast radius could not be computed.',
  index_partial: 'The repo index is only partially built, so this result may be incomplete.',
  repo_too_large: 'This repo is too large to fully index, so blast radius could not be computed.',
  no_data: 'No index data is available yet for this repo.',
  caller_cap: 'Some symbols have more callers than shown here; the list was capped.',
  depth_cap: 'The impact walk may extend further than the depth this result explored.',
  no_impact: 'No downstream callers, endpoints, or crons were found for these changes.',
};

const DEFAULT_REASON_TEXT = 'Blast radius could not be fully computed.';

function reasonText(reason: string | null): string | null {
  if (reason === null) return null;
  return REASON_TEXT[reason] ?? DEFAULT_REASON_TEXT;
}

/**
 * Rule 1: `index_status` derivation. Exported so `blast/service.ts` can decide
 * — BEFORE calling the expensive `getBlastRadius`/`getReverseImpact` facade
 * methods — whether the index is usable, using the exact same condition
 * `assembleBlastRadius` itself uses to classify `index_status` as `'missing'`,
 * `'degraded'`, or `'failed'`. Single source of truth so the two call sites
 * can never drift apart (see architecture-reviewer REQ-5 fix).
 */
export function deriveIndexStatus(index: IndexState): BlastIndexStatus {
  return index.lastIndexedSha === '' && index.degradedReason === 'no_data' ? 'missing' : index.status;
}

/** Lexicographically-smallest declaring file per changed-symbol name (rule 3). */
function declaringFilesByName(changedSymbols: BlastResult['changedSymbols']): Map<string, string> {
  const byName = new Map<string, string>();
  for (const s of changedSymbols) {
    const current = byName.get(s.name);
    if (current === undefined || s.file < current) byName.set(s.name, s.file);
  }
  return byName;
}

/**
 * Group `blast.callers` by `viaSymbol`, dropping same-file self-references
 * (REQ-2(c) / Gotcha 3), sorted `rank` desc, `file` asc, `line` asc (rule 2).
 */
function groupCallers(
  callers: BlastCallerRow[],
  declaringFileByName: Map<string, string>,
): Map<string, BlastCallerRow[]> {
  const groups = new Map<string, BlastCallerRow[]>();
  for (const caller of callers) {
    const declaringFile = declaringFileByName.get(caller.viaSymbol);
    if (declaringFile !== undefined && caller.file === declaringFile) continue;
    const group = groups.get(caller.viaSymbol);
    if (group) group.push(caller);
    else groups.set(caller.viaSymbol, [caller]);
  }
  for (const group of groups.values()) {
    group.sort((a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.line - b.line);
  }
  return groups;
}

/**
 * Union of endpoints/crons attributable to a symbol (rule 4).
 *
 * `reverse` is a single BATCHED walk over the PR's whole changed-file set
 * (one `getReverseImpact` call, not one per symbol — REQ-5 efficiency), so
 * part (b) must not naively apply every reachable file to every symbol: a
 * file reached only from an unrelated changed file must not leak into this
 * symbol's `endpoints_affected`/`crons_affected`. `reverse.originsByFile`
 * carries, per visited file, which origin changed-file(s) reached it — so
 * part (b) is scoped to only the files whose origin set includes THIS
 * symbol's own declaring file (`declaringFile`).
 */
function attributedFacts(
  callerGroup: BlastCallerRow[],
  factsByFile: BlastResult['factsByFile'],
  reverse: ReverseImpactResult,
  declaringFile: string,
): { endpoints: string[]; crons: string[] } {
  const endpoints = new Set<string>();
  const crons = new Set<string>();

  // (a) facts on each of this symbol's own caller files.
  for (const caller of callerGroup) {
    const facts = factsByFile?.[caller.file];
    if (!facts) continue;
    for (const e of facts.endpoints) endpoints.add(e);
    for (const c of facts.crons) crons.add(c);
  }

  // (b) facts on every file reachable via the reverse import-graph walk FROM
  // this symbol's own declaring file — not the whole batched changed-file
  // set (see doc comment above).
  for (const file of reverse.files) {
    const origins = reverse.originsByFile[file];
    if (!origins || !origins.includes(declaringFile)) continue;
    const facts = reverse.byFile[file];
    if (!facts) continue;
    for (const e of facts.endpoints) endpoints.add(e);
    for (const c of facts.crons) crons.add(c);
  }

  return { endpoints: [...endpoints].sort(), crons: [...crons].sort() };
}

/**
 * Prior-PR input shape. Declared structurally rather than imported from
 * `reviews/repository.ts` so this pure assembler keeps its property of never
 * importing another module's data-access layer (today it imports only
 * `@devdigest/shared` and `repo-intel/types.js`). `PriorPrRow` from
 * `reviews/repository.ts` structurally satisfies it; `blast/service.ts`'s
 * typecheck is what pins the two together, and will fail loudly if either
 * side drifts.
 */
export interface PriorPrSource {
  number: number;
  title: string;
  updatedAt: Date | null;
}

/** Pure row → contract mapping. No filtering, no sorting — the repository
 *  already applied REQ-2's ordering and cap. */
export function toPriorPrs(rows: PriorPrSource[]): PriorPr[] {
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
  }));
}

export function assembleBlastRadius(input: {
  blast: BlastResult;
  index: IndexState;
  reverse: ReverseImpactResult;
  changedFiles: string[];
  now: Date;
  /** Reference data only — see the doc block above. Optional so callers that
   *  don't yet compute prior PRs (or don't care, e.g. existing tests) can omit
   *  it; treated identically to an empty array. */
  priorPrs?: PriorPrSource[];
}): BlastRadius {
  const { blast, index, reverse, now } = input;

  // Rule 1: index_status.
  const indexStatus: BlastIndexStatus = deriveIndexStatus(index);

  // Rule 2/3: group callers per symbol name, resolve declaring file, cap.
  const declaringFileByName = declaringFilesByName(blast.changedSymbols);
  const groupsByName = groupCallers(blast.callers, declaringFileByName);

  let truncated = false;
  const symbolNames = [...new Set(blast.changedSymbols.map((s) => s.name))].sort();

  const downstream: DownstreamImpact[] = symbolNames.map((name) => {
    const file = declaringFileByName.get(name) ?? '';
    const group = groupsByName.get(name) ?? [];
    const callerCount = group.length;
    if (callerCount > MAX_CALLERS_PER_SYMBOL) truncated = true;

    const callers = group.slice(0, MAX_CALLERS_PER_SYMBOL).map((c) => ({
      name: c.symbol,
      file: c.file,
      line: c.line,
    }));

    const { endpoints, crons } = attributedFacts(group, blast.factsByFile, reverse, file);

    return {
      symbol: name,
      file,
      caller_count: callerCount,
      callers,
      endpoints_affected: endpoints,
      crons_affected: crons,
    };
  });

  // Rule 5: state, first match wins.
  let state: BlastState;
  let reason: string | null;
  if (blast.degraded === true || indexStatus === 'degraded' || indexStatus === 'failed' || indexStatus === 'missing') {
    state = 'degraded';
    reason = blast.reason ?? index.degradedReason ?? 'no_data';
  } else if (indexStatus === 'partial' || truncated || reverse.depthLimited) {
    state = 'partial';
    reason = indexStatus === 'partial' ? 'index_partial' : truncated ? 'caller_cap' : 'depth_cap';
  } else if (
    blast.changedSymbols.length === 0 ||
    downstream.every((d) => d.caller_count === 0 && d.endpoints_affected.length === 0 && d.crons_affected.length === 0)
  ) {
    state = 'empty';
    reason = 'no_impact';
  } else {
    state = 'ok';
    reason = null;
  }

  // Prior PRs are computed last, AFTER state/reason/truncated/index_status are
  // already decided above — reference data must never feed back into the
  // state machine (REQ-5).
  const priorPrs = toPriorPrs(input.priorPrs ?? []);

  return {
    changed_symbols: blast.changedSymbols.map((s) => ({ name: s.name, file: s.file, kind: s.kind })),
    downstream,
    prior_prs: priorPrs,
    summary: '',
    state,
    reason,
    reason_text: reasonText(reason),
    truncated,
    index_status: indexStatus,
    generated_at: now.toISOString(),
  };
}
