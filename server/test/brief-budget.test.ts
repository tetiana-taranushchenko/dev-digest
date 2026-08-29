import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@devdigest/shared';
import type { BriefPromptSection } from '@devdigest/reviewer-core';
import type { Tokenizer } from '../src/adapters/tokenizer/index.js';
import { trimToBudget } from '../src/modules/brief/budget.js';

/**
 * `trimToBudget` (T5c, `docs/plans/pr-brief.md`) — the budget trimmer that
 * re-assembles and re-counts the FULL prompt on every iteration. `assemble`
 * is always a trivial fake here (never the real `assembleBriefPrompt`),
 * matching the plan's "budget.ts stays unit-testable with a trivial fake"
 * design.
 */

/** Deterministic char-count tokenizer, mirroring `repo-intel-rank-map.test.ts`'s
 *  `charTokenizer` convention — makes token budgets exact in assertions. */
const charTokenizer: Tokenizer = { count: (text: string) => text.length };

function pr(overrides: Partial<Extract<BriefPromptSection, { kind: 'pr' }>> = {}): BriefPromptSection {
  return { name: 'pr', droppable: false, kind: 'pr', title: 'Title', body: 'Body', ...overrides };
}

function intent(content = 'intent content'): BriefPromptSection {
  return { name: 'intent', droppable: true, kind: 'intent', content };
}

function blast(content = 'blast content'): BriefPromptSection {
  return { name: 'blast', droppable: true, kind: 'blast', content };
}

function paths(fileCount = 3): BriefPromptSection {
  const files = Array.from({ length: fileCount }, (_, i) => ({
    path: `src/file-${i}.ts`,
    additions: 1,
    deletions: 0,
  }));
  return { name: 'paths', droppable: true, kind: 'diff_stats', files };
}

function issue(content = 'issue content'): BriefPromptSection {
  return { name: 'issue', droppable: true, kind: 'issue', content };
}

function commits(content = 'commit content'): BriefPromptSection {
  return { name: 'commits', droppable: true, kind: 'commits', content };
}

function docs(name: string, content: string): BriefPromptSection {
  return { name, droppable: true, kind: 'docs', content };
}

/** Renders every section kind to a flat string so the fake `assemble` below
 *  can build a deterministic, char-countable prompt. */
function renderSection(section: BriefPromptSection): string {
  switch (section.kind) {
    case 'pr':
      return `PR:${section.title}${section.body}`;
    case 'diff_stats':
      return `PATHS:${section.files.map((f) => f.path).join(',')}`;
    default:
      return `${section.kind.toUpperCase()}:${section.content}`;
  }
}

/** A trivial fake `assemble` — concatenates every section's rendered text
 *  into a single user message, prefixed by a fixed-size system message. */
function makeAssemble(systemOverhead = ''): (sections: BriefPromptSection[]) => ChatMessage[] {
  return (sections) => [
    { role: 'system', content: `SYS${systemOverhead}` },
    { role: 'user', content: sections.map(renderSection).join('\n') },
  ];
}

describe('trimToBudget', () => {
  it('drops a section when the set fits raw but not assembled (measures the assembled prompt, not raw sections)', () => {
    // Each section's own raw content is tiny (well under budget on its own),
    // but the fake `assemble` below adds a large FIXED overhead per section
    // that only shows up once the prompt is actually assembled.
    const OVERHEAD = 'x'.repeat(20);
    const assemble = (sections: BriefPromptSection[]): ChatMessage[] => [
      { role: 'system', content: '' },
      { role: 'user', content: sections.map((s) => OVERHEAD + renderSection(s)).join('') },
    ];

    const sections = [pr({ title: 'a', body: '' }), intent('aaaaa')];
    // Raw section content alone ("a" + "" + "aaaaa" = 6 chars) trivially fits
    // any reasonable budget — but each section costs +20 chars of overhead
    // once assembled, which is what actually blows the budget.
    const rawContentLength = 'a'.length + 'aaaaa'.length;
    expect(rawContentLength).toBeLessThan(40);

    const result = trimToBudget(sections, 40, charTokenizer, assemble);

    expect(result.dropped).toEqual(['intent']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sections.map((s) => s.name)).toEqual(['pr']);
      expect(result.tokens).toBeLessThanOrEqual(40);
    }
  });

  it('drops oversized attached documents and a 900-entry path list in exact D9 order', () => {
    const sections = [
      pr(),
      intent('i'.repeat(50)),
      blast('b'.repeat(50)),
      paths(900),
      issue('q'.repeat(50)),
      commits('c'.repeat(50)),
      docs('doc:a.md', 'd'.repeat(5000)),
      docs('doc:b.md', 'e'.repeat(5000)),
    ];
    const assemble = makeAssemble();

    // Budget forces every droppable section to go except `intent` (the
    // highest-priority droppable), which together with the undroppable
    // `pr` section already fits: this exercises the FULL documented drop
    // order — docs → commits → issue → paths → blast.
    const survivorsOnlyTokens = charTokenizer
      .count(assemble([pr(), intent('i'.repeat(50))]).map((m) => m.content).join(''));
    const result = trimToBudget(sections, survivorsOnlyTokens, charTokenizer, assemble);

    expect(result.dropped).toEqual(['doc:a.md', 'doc:b.md', 'commits', 'issue', 'paths', 'blast']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sections.map((s) => s.name)).toEqual(['pr', 'intent']);
    }
  });

  it('returns the messages produced by the final assemble call, not a re-assembled prompt', () => {
    const sections = [pr(), intent('i'.repeat(500)), blast('short')];
    const assemble = vi.fn(makeAssemble());

    const result = trimToBudget(sections, 30, charTokenizer, assemble);

    expect(result.ok).toBe(true);
    expect(assemble).toHaveBeenCalled();
    const lastCallResult = assemble.mock.results[assemble.mock.results.length - 1]?.value;
    if (result.ok) {
      expect(result.messages).toBe(lastCallResult);
    }
  });

  it('returns ok: false when even the undroppable PR section alone exceeds the budget', () => {
    const sections = [pr({ title: 'x'.repeat(1000), body: 'y'.repeat(1000) }), intent(), blast()];
    const assemble = makeAssemble();

    const result = trimToBudget(sections, 10, charTokenizer, assemble);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // D9 drop order: blast is lower-priority (dropped earlier) than intent.
      expect(result.dropped).toEqual(['blast', 'intent']);
      expect(result.tokens).toBeGreaterThan(10);
    }
  });
});
