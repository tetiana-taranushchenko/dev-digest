import { pgTable, uuid, text, integer, primaryKey, index } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { skills } from './skills';

// ============================================================ Attached context documents
//
// Ordered, repo-relative document paths (never bodies) attached to an agent or
// a skill — modelled on `agentSkills` (`./agents.ts`). `order` drives the
// deduped, direct-first-then-linked-skills injection order (AC-8/AC-15); the
// `path` index backs the `used_by` count query (AC-1).

export const agentContextDocs = pgTable(
  'agent_context_docs',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.agentId, t.path] }),
    pathIdx: index('agent_context_docs_path_idx').on(t.path),
  }),
);

export const skillContextDocs = pgTable(
  'skill_context_docs',
  {
    skillId: uuid('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skillId, t.path] }),
    pathIdx: index('skill_context_docs_path_idx').on(t.path),
  }),
);
