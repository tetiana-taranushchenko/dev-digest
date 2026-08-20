/**
 * repo-intel — shared contract (Tier 1).
 *
 * This is the SINGLE interface every feature codes against. Library complexity
 * (@ast-grep/napi, dependency-cruiser, graphology, tokenizer) hides behind the
 * `RepoIntel` facade; features (reviews prompt-assembly, blast, onboarding,
 * conventions, phantom-gate, smart-diff) import THIS, never the libraries.
 *
 * Adapted to real code:
 *   - `repos.id` is a `uuid`, so every `repoId` here is a `string`.
 *   - facade-level rows (SymbolRow / SignatureRow / RefRow) mirror the read model.
 *   - adapter-level extraction types live with the astgrep adapter and stay
 *     compatible with `adapters/codeindex/extract.ts` (ExtractedSymbol/Reference).
 *
 * DEGRADED CONTRACT (lead decision — resolves the read-model vs degraded-contract ambiguity):
 *   - Object-returning methods carry an inline `degraded?: boolean` (+ optional
 *     `reason`). See BlastResult / IndexState / RepoMapResult.
 *   - Array-returning methods return `[]` when degraded. Empty = "no enrichment",
 *     which is exactly what every consumer already treats as the fallback path.
 *     The degraded *status/reason* is always observable via `getIndexState()`.
 * This keeps signatures natural (no `{ degraded, data }` wrappers at call sites)
 * while still guaranteeing every consumer can fall back without throwing.
 */

export type IndexStatus = 'full' | 'partial' | 'degraded' | 'failed';

export type DegradedReason =
  | 'flag_off'
  | 'index_failed'
  | 'index_partial'
  | 'repo_too_large'
  | 'no_data';

export interface IndexResult {
  status: IndexStatus;
  filesIndexed: number;
  filesSkipped: number;
  durationMs: number;
  reason?: string;
}

export interface IndexState extends IndexResult {
  repoId: string;
  lastIndexedSha: string;
  indexerVersion: number;
  updatedAt: Date;
  /** True when the layer is running on the ripgrep fallback. */
  degraded?: boolean;
  degradedReason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Blast radius (facade method `getBlastRadius`). Adopted by blast/service.ts in
// T2; in T1 the facade returns a degraded best-effort over container.codeIndex.
// ---------------------------------------------------------------------------

export interface BlastChangedSymbol {
  file: string;
  name: string;
  kind: string;
}

export interface BlastCallerRow {
  file: string;
  symbol: string;
  /** Which changed symbol this caller reaches. */
  viaSymbol: string;
  /** 1-based line of the reference (representative; for the BlastRadius view). */
  line: number;
  /** file_rank.rank of the caller file (0 in the degraded/ripgrep path). */
  rank: number;
}

export interface BlastResult {
  changedSymbols: BlastChangedSymbol[];
  callers: BlastCallerRow[];
  /** "METHOD /path" (via extractEndpoints / file_facts) — flat union. */
  impactedEndpoints: string[];
  /**
   * Per-caller-file precomputed facts, so consumers (blast) can attribute
   * endpoints/crons to the changed symbol whose callers live in that file.
   * Present on the persistent (non-degraded) path; absent otherwise.
   */
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  degraded?: boolean;
  reason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Reverse impact (facade method `getReverseImpact`, T3). Walks the import
// graph BACKWARD from the changed files — "who depends on this?" — up to
// `BFS_DEPTH` hops via `repository.getImporters` (the reverse-lookup over
// `file_edges_repo_to_idx`), then attaches per-file facts (endpoints/crons)
// for the visited set with a single `getFileFacts` call.
// ---------------------------------------------------------------------------

export interface ReverseImpactResult {
  /**
   * Files reachable by walking the reverse import graph from the changed
   * files, up to `BFS_DEPTH` hops. Excludes the original `changedFiles`.
   */
  files: string[];
  /** Union of endpoints attributable to any visited file. */
  endpoints: string[];
  /** Union of crons attributable to any visited file. */
  crons: string[];
  /**
   * Per-visited-file endpoints/crons, so consumers (blast) can attribute
   * impact back to the specific file that declares it.
   */
  byFile: Record<string, { endpoints: string[]; crons: string[] }>;
  /**
   * Provenance: for each visited file, which of the ORIGINAL `changedFiles`
   * reached it during the BFS (a file can be reached from more than one
   * origin, e.g. a shared downstream dependency). This is what lets a
   * multi-origin consumer (blast/assemble.ts) scope facts to only the
   * origin file it cares about, instead of treating the whole batched
   * result as one flat, origin-less set. Populated without any extra
   * `getImporters` round-trips — the BFS already processes a frontier per
   * round, so provenance is propagated forward from each frontier file's
   * own origin-set as edges are discovered.
   */
  originsByFile: Record<string, string[]>;
  /**
   * True when the BFS was still finding new, unvisited files at the depth
   * cutoff — i.e. there was more graph beyond what `BFS_DEPTH` allowed it to
   * explore (as opposed to the walk having genuinely exhausted the graph).
   */
  depthLimited: boolean;
  degraded?: boolean;
  reason?: DegradedReason;
}

// ---------------------------------------------------------------------------
// Read-model rows.
// ---------------------------------------------------------------------------

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface SignatureRow {
  file: string;
  symbol: string;
  signature: string;
  /** file_rank.rank of the caller (0 until T3). */
  rank: number;
}

export interface RefRow {
  refFile: string;
  refLine: number;
  symbolName: string;
  /** NULL = unresolved → candidate for the Phantom-gate. */
  declFile: string | null;
}

export interface FileRankRow {
  path: string;
  percentile: number;
}

export interface RepoMapResult {
  text: string;
  tokens: number;
  cached: boolean;
  degraded?: boolean;
  reason?: DegradedReason;
}

/**
 * The facade. Studio (T2+) serves reads purely from the Postgres cache; T1 and
 * CI may parse diff-scoped on the hot path. Indexing runs through
 * JobRunner handlers in studio, inline in the CI runner.
 */
export interface RepoIntel {
  // --- Indexing -----------------------------------------------------------
  /** Full (re)index of a repo. */
  indexRepo(repoId: string): Promise<IndexResult>;
  /** Incremental update against the last indexed SHA. */
  refreshIndex(repoId: string): Promise<IndexResult>;
  /** Current index state — ALWAYS works, even degraded. */
  getIndexState(repoId: string): Promise<IndexState>;

  // --- Reads --------------------------------------------------------------
  getBlastRadius(repoId: string, changedFiles: string[]): Promise<BlastResult>;
  getRepoMap(repoId: string, tokenBudget?: number): Promise<RepoMapResult>;
  getFileRank(repoId: string, paths: string[]): Promise<FileRankRow[]>;
  getSymbolsInFiles(repoId: string, paths: string[]): Promise<SymbolRow[]>;
  getCallerSignatures(
    repoId: string,
    changedFiles: string[],
    limit?: number,
  ): Promise<SignatureRow[]>;
  /**
   * Unresolved references (= Phantom-gate fuel).
   * T1: diff-scoped, ephemeral (no persistent decl_file).
   * T2/T3: persistent `references.decl_file IS NULL`.
   */
  getUnresolvedReferences(repoId: string, files: string[]): Promise<RefRow[]>;
  /** Top-N file paths by rank, filtered of tests/configs. */
  getConventionSamples(repoId: string, n: number): Promise<string[]>;

  // --- T3: onboarding reading-path + critical paths (graph required) ------
  getTopFilesByRank(
    repoId: string,
    n: number,
    opts?: { exclude?: string[] },
  ): Promise<string[]>;
  getCriticalPaths(repoId: string): Promise<string[][]>;

  /**
   * Reverse import-graph walk from `changedFiles` outward ("who depends on
   * this?"), up to `BFS_DEPTH` hops. Used by `blast/` to attribute HTTP
   * endpoints/crons reachable transitively from a changed file.
   */
  getReverseImpact(repoId: string, changedFiles: string[]): Promise<ReverseImpactResult>;
}
