/**
 * T2 — `assembleBriefPrompt` (reviewer-core/src/brief/prompt.ts).
 *
 * (a) a sentinel planted in a diff-hunk-shaped fixture never appears in the
 *     assembled messages, while the file's path and +/- counts do (AC-5).
 * (b) every untrusted field appears only inside `<untrusted source="...">`
 *     blocks and `INJECTION_GUARD`'s text is in the system message.
 */
import { describe, it, expect } from 'vitest';
import { assembleBriefPrompt, type BriefPromptSection } from '../src/brief/prompt.js';
import { INJECTION_GUARD } from '../src/prompt.js';

function assembled(sections: BriefPromptSection[]) {
  const messages = assembleBriefPrompt(sections);
  return { system: messages[0]!.content, user: messages[1]!.content, messages };
}

describe('assembleBriefPrompt — never a diff hunk body (AC-5)', () => {
  it('renders path/+/- counts from a diff_stats section but never a hunk sentinel smuggled onto a file entry', () => {
    const sentinel = 'SENTINEL_DIFF_HUNK_BODY_+old_line_-removed_line';

    const section: BriefPromptSection = {
      kind: 'diff_stats',
      name: 'diff-stats',
      droppable: true,
      files: [
        // `patch` is not part of `BriefDiffStatEntry` — cast to simulate a
        // caller mistakenly attaching a raw hunk body at runtime, since TS
        // types don't exist at runtime.
        { path: 'src/foo.ts', additions: 3, deletions: 1, patch: sentinel } as unknown as {
          path: string;
          additions: number;
          deletions: number;
        },
      ],
    };

    const { user } = assembled([section]);

    expect(user).toContain('src/foo.ts');
    expect(user).toContain('+3');
    expect(user).toContain('-1');
    expect(user).not.toContain(sentinel);
  });
});

describe('assembleBriefPrompt — untrusted wrapping + injection guard', () => {
  it('wraps every section kind inside its own <untrusted source="..."> block, nowhere else', () => {
    const sections: BriefPromptSection[] = [
      { kind: 'pr', name: 'pr', droppable: false, title: 'PR_TITLE_MARKER', body: 'PR_BODY_MARKER' },
      {
        kind: 'diff_stats',
        name: 'diff-stats',
        droppable: true,
        files: [{ path: 'src/a.ts', additions: 2, deletions: 0 }],
      },
      { kind: 'intent', name: 'intent', droppable: true, content: 'INTENT_MARKER' },
      { kind: 'blast', name: 'blast', droppable: true, content: 'BLAST_MARKER' },
      { kind: 'issue', name: 'issue', droppable: true, content: 'ISSUE_MARKER' },
      { kind: 'commits', name: 'commits', droppable: true, content: 'COMMITS_MARKER' },
      { kind: 'docs', name: 'doc-0', droppable: true, content: 'DOC_MARKER' },
    ];

    const { user } = assembled(sections);

    // Each marker appears, and only inside an <untrusted> block.
    const markers = [
      'PR_TITLE_MARKER',
      'PR_BODY_MARKER',
      'INTENT_MARKER',
      'BLAST_MARKER',
      'ISSUE_MARKER',
      'COMMITS_MARKER',
      'DOC_MARKER',
    ];

    const untrustedBlocks = [...user.matchAll(/<untrusted source="[^"]+">([\s\S]*?)<\/untrusted>/g)].map(
      (m) => m[1]!,
    );
    const strippedOfBlocks = user.replace(/<untrusted source="[^"]+">[\s\S]*?<\/untrusted>/g, '');

    for (const marker of markers) {
      expect(user).toContain(marker);
      expect(untrustedBlocks.some((block) => block.includes(marker))).toBe(true);
      expect(strippedOfBlocks).not.toContain(marker);
    }

    // Distinct source labels for each untrusted section.
    expect(user).toContain('<untrusted source="pr">');
    expect(user).toContain('<untrusted source="diff-stats">');
    expect(user).toContain('<untrusted source="intent">');
    expect(user).toContain('<untrusted source="blast">');
    expect(user).toContain('<untrusted source="issue">');
    expect(user).toContain('<untrusted source="commits">');
    expect(user).toContain('<untrusted source="spec-0">');
  });

  it('includes INJECTION_GUARD in the system message', () => {
    const { system } = assembled([
      { kind: 'pr', name: 'pr', droppable: false, title: 'T', body: 'B' },
    ]);
    expect(system).toContain(INJECTION_GUARD);
  });

  it('includes INJECTION_GUARD in the system message even with no sections', () => {
    const { system } = assembled([]);
    expect(system).toContain(INJECTION_GUARD);
  });
});
