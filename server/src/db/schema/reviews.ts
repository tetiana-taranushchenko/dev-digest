import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type { IntentSource, Brief, BriefDrop } from '@devdigest/shared';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { agents } from './agents';

// ============================================================ Review & findings

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id'),
  /** The agent_run that produced this review (links the timeline run ↔ review). */
  runId: uuid('run_id'),
  kind: text('kind', { enum: ['summary', 'review'] }).notNull(),
  verdict: text('verdict'),
  summary: text('summary'),
  score: integer('score'),
  model: text('model'),
  createdAt: now(),
});

export const findings = pgTable('findings', {
  id: uuid('id').primaryKey().defaultRandom(),
  reviewId: uuid('review_id')
    .notNull()
    .references(() => reviews.id, { onDelete: 'cascade' }),
  file: text('file').notNull(),
  startLine: integer('start_line').notNull(),
  endLine: integer('end_line').notNull(),
  severity: text('severity').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  rationale: text('rationale').notNull(),
  suggestion: text('suggestion'),
  confidence: doublePrecision('confidence').notNull(),
  kind: text('kind').notNull().default('finding'),
  trifectaComponents: jsonb('trifecta_components').$type<string[]>(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
});

export const prIntent = pgTable('pr_intent', {
  prId: uuid('pr_id')
    .primaryKey()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  intent: text('intent').notNull(),
  inScope: jsonb('in_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outOfScope: jsonb('out_of_scope').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** Code-derived confidence tier (never model-self-reported) — see REQ-4. */
  confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull().default('low'),
  /** Human-readable sentence naming the deciding signals, for the UI tooltip. */
  confidenceReason: text('confidence_reason'),
  /** Which signals were available/fetched for this classification. */
  sources: jsonb('sources').$type<IntentSource[]>().notNull().default(sql`'[]'::jsonb`),
  /** Classifier provider actually used. */
  provider: text('provider'),
  /** Classifier model actually used. */
  model: text('model'),
  /** Cache key — recompute when the PR head moves. */
  headSha: text('head_sha'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** USD cost of this classification; null when unknown. */
  costUsd: doublePrecision('cost_usd'),
  durationMs: integer('duration_ms'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const prBrief = pgTable(
  'pr_brief',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prId: uuid('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** FK + cascade: a Brief keyed to a deleted agent is unreachable by
     *  construction (agent_id is part of the state key), so it is deleted with
     *  the agent rather than orphaned. Deliberately unlike `reviews.agentId`,
     *  which is FK-less to preserve run history. */
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    /** The one composite freshness key. Opaque SHA-256; the components below
     *  are stored only for debugging. */
    stateKey: text('state_key').notNull(),
    headSha: text('head_sha').notNull(),
    docsMetaFingerprint: text('docs_meta_fingerprint').notNull(),
    /** `revisionOf`-based content hash. NOT part of the key (GET can't compute
     *  it without reading bodies) — observability only. */
    docsContentFingerprint: text('docs_content_fingerprint').notNull(),
    indexSha: text('index_sha').notNull(),
    json: jsonb('json').notNull().$type<Brief>(),
    intentAvailable: boolean('intent_available').notNull(),
    blastAvailable: boolean('blast_available').notNull(),
    droppedSections: jsonb('dropped_sections').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Each drop recorded WITH its reason, not just a count. */
    droppedCitations: jsonb('dropped_citations')
      .$type<BriefDrop[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    provider: text('provider'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /** From `StructuredResult.attempts` — the billed-generation count. */
    attempts: integer('attempts'),
    costUsd: doublePrecision('cost_usd'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // The upsert conflict target AND the cache lookup both paths use.
    stateKeyUq: uniqueIndex('pr_brief_state_key_idx').on(table.prId, table.agentId, table.stateKey),
    // agentId isn't the leftmost column of stateKeyUq, so a per-agent lookup
    // or an agents-row cascade delete would otherwise sequential-scan this
    // table as it grows (pr-self-review, postgresql-table-design finding).
    agentIdIdx: index('pr_brief_agent_id_idx').on(table.agentId),
  }),
);
