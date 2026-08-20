import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiffGroup } from "@devdigest/shared";
import smartDiffMessages from "../../../../../../../../messages/en/smartDiff.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

const NO_SPLIT = { too_big: false, total_lines: 0, proposed_splits: [] };

function finding(id: string, severity: FindingRecord["severity"] = "WARNING"): FindingRecord {
  return {
    id,
    review_id: "review-1",
    severity,
    category: "bug",
    title: `${severity.toLowerCase()} risk`,
    file: "src/core.ts",
    start_line: 2,
    end_line: 2,
    rationale: "Risk rationale",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    accepted_at: null,
    dismissed_at: null,
  };
}

function review(findings: FindingRecord[]): ReviewRecord {
  return {
    id: "review-1",
    pr_id: "pr-1",
    agent_id: "agent-1",
    run_id: "run-1",
    agent_name: "Reviewer",
    kind: "review",
    verdict: "comment",
    summary: null,
    score: 80,
    model: "test",
    grounding: null,
    created_at: "2026-01-02T00:00:00Z",
    findings,
  };
}

function renderViewer(args: {
  groups: SmartDiffGroup[];
  files: PrFile[];
  reviews?: ReviewRecord[];
  reviewTokens?: number | null;
  splitSuggestion?: typeof NO_SPLIT;
  onFindingClick?: (id: string) => void;
  targetFile?: string | null;
}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ smartDiff: smartDiffMessages, shell: shellMessages }}>
      <SmartDiffViewer
        groups={args.groups}
        files={args.files}
        reviews={args.reviews ?? []}
        reviewTokens={args.reviewTokens ?? null}
        splitSuggestion={args.splitSuggestion ?? NO_SPLIT}
        onFindingClick={args.onFindingClick ?? vi.fn()}
        targetFile={args.targetFile}
      />
    </NextIntlClientProvider>,
  );
}

describe("SmartDiffViewer", () => {
  it("renders server order with instructor group chrome and disclosure defaults", () => {
    const groups: SmartDiffGroup[] = [
      {
        role: "core",
        files: [
          { path: "src/z-first.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] },
          { path: "src/a-second.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] },
        ],
      },
      { role: "wiring", files: [{ path: "config.yml", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] }] },
      { role: "boilerplate", files: [{ path: "pnpm-lock.yaml", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] }] },
    ];
    const files: PrFile[] = [
      { path: "src/z-first.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+first core line" },
      { path: "src/a-second.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+second core line" },
      { path: "config.yml", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+wiring line" },
      { path: "pnpm-lock.yaml", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+lock line" },
    ];

    renderViewer({ groups, files });

    const core = screen.getByRole("button", { name: /Core logic/ });
    const wiring = screen.getByRole("button", { name: /Wiring/ });
    const boilerplate = screen.getByRole("button", { name: /Boilerplate/ });
    expect(core).toHaveAttribute("aria-expanded", "true");
    expect(wiring).toHaveAttribute("aria-expanded", "true");
    expect(boilerplate).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("The substance of the change — review closely")).toBeInTheDocument();
    expect(within(core).getByText("2 files")).toBeInTheDocument();
    expect(within(wiring).getByText("1 file")).toBeInTheDocument();
    const firstCorePath = screen.getByText("src/z-first.ts");
    const secondCorePath = screen.getByText("src/a-second.ts");
    expect(screen.getByText("first core line")).toBeInTheDocument();
    expect(screen.getByText("second core line")).toBeInTheDocument();
    expect(screen.getByText("wiring line")).toBeInTheDocument();
    expect(screen.queryByText("lock line")).not.toBeInTheDocument();
    expect(core.compareDocumentPosition(wiring) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(wiring.compareDocumentPosition(boilerplate) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(firstCorePath.compareDocumentPosition(secondCorePath) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(boilerplate);
    expect(screen.getByText("lock line")).toBeInTheDocument();
  });

  it("places multiple severity markers on the exact line and forwards the selected finding id", () => {
    const warning = finding("warning-1", "WARNING");
    const critical = finding("critical-1", "CRITICAL");
    const onFindingClick = vi.fn();
    const groups: SmartDiffGroup[] = [
      {
        role: "core",
        files: [
          {
            path: "src/core.ts",
            pseudocode_summary: null,
            additions: 1,
            deletions: 0,
            line_findings: [
              { id: "warning-1", line: 2, severity: "WARNING" },
              { id: "critical-1", line: 2, severity: "CRITICAL" },
            ],
          },
        ],
      },
    ];
    const files: PrFile[] = [
      { path: "src/core.ts", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n context\n+danger" },
    ];

    renderViewer({ groups, files, reviews: [review([warning, critical])], onFindingClick });

    expect(screen.getByText("2 findings")).toBeInTheDocument();
    const row = document.querySelector('[data-diff-line="src/core.ts:2"]') as HTMLElement;
    expect(row).toBeInTheDocument();
    const controls = within(row).getAllByRole("button");
    expect(controls.map((control) => control.textContent)).toEqual(["critical", "warning"]);

    fireEvent.click(
      within(row).getByRole("button", {
        name: "Open warning finding warning risk at src/core.ts:2",
      }),
    );
    expect(onFindingClick).toHaveBeenCalledTimes(1);
    expect(onFindingClick).toHaveBeenCalledWith("warning-1");
  });

  it("omits the file finding count when an authoritative finding line is absent from the rendered patch", () => {
    const groups: SmartDiffGroup[] = [
      {
        role: "core",
        files: [
          {
            path: "src/core.ts",
            pseudocode_summary: null,
            additions: 1,
            deletions: 0,
            line_findings: [{ id: "missing-row", line: 2, severity: "WARNING" }],
          },
        ],
      },
    ];
    const files: PrFile[] = [
      { path: "src/core.ts", additions: 1, deletions: 0, patch: "@@ -9,0 +10,1 @@\n+visible line" },
    ];

    renderViewer({ groups, files, reviews: [review([finding("missing-row")])] });

    expect(screen.queryByText("1 finding")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open warning finding/ })).not.toBeInTheDocument();
  });

  it("renders the large-PR warning, large-file treatment, and grounded token status", () => {
    const groups: SmartDiffGroup[] = [
      {
        role: "core",
        files: [{ path: "src/core.ts", pseudocode_summary: null, additions: 151, deletions: 0, line_findings: [] }],
      },
    ];
    const files: PrFile[] = [
      { path: "src/core.ts", additions: 151, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+large" },
    ];

    renderViewer({
      groups,
      files,
      reviews: [review([])],
      reviewTokens: 125,
      splitSuggestion: { too_big: true, total_lines: 451, proposed_splits: [] },
    });

    expect(screen.getByText("This PR is large (451 changed lines)")).toBeInTheDocument();
    expect(screen.getByText("0 new tokens · built on 125 from last review")).toBeInTheDocument();
    expect(screen.getByLabelText("Large file src/core.ts: 151 changed lines")).toBeInTheDocument();
  });

  it("omits token provenance when the server has no authoritative review_tokens (e.g. incomplete run data)", () => {
    const groups: SmartDiffGroup[] = [
      { role: "core", files: [{ path: "src/core.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] }] },
    ];
    const files: PrFile[] = [
      { path: "src/core.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+core" },
    ];

    renderViewer({ groups, files, reviews: [review([])], reviewTokens: null });

    expect(screen.queryByText(/0 new tokens/)).not.toBeInTheDocument();
  });

  it("forces open the boilerplate group and file card containing targetFile, leaving other groups/files at their default", () => {
    const groups: SmartDiffGroup[] = [
      {
        role: "core",
        files: [{ path: "src/core.ts", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] }],
      },
      {
        role: "boilerplate",
        files: [
          { path: "pnpm-lock.yaml", pseudocode_summary: null, additions: 1, deletions: 0, line_findings: [] },
          { path: "src/large-target.ts", pseudocode_summary: null, additions: 999, deletions: 0, line_findings: [] },
        ],
      },
    ];
    const files: PrFile[] = [
      { path: "src/core.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+core line" },
      { path: "pnpm-lock.yaml", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+lock line" },
      { path: "src/large-target.ts", additions: 999, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+target line" },
    ];

    renderViewer({ groups, files, targetFile: "src/large-target.ts" });

    // The boilerplate group normally starts collapsed, but it's forced open
    // because it contains the target file.
    const boilerplate = screen.getByRole("button", { name: /Boilerplate/ });
    expect(boilerplate).toHaveAttribute("aria-expanded", "true");
    // The targeted file's lines render even though its size would normally
    // auto-collapse its FileCard.
    expect(screen.getByText("target line")).toBeInTheDocument();
    // A sibling file in the same forced-open group keeps its own default —
    // it's small, so it renders too (not forced, just naturally expanded).
    expect(screen.getByText("lock line")).toBeInTheDocument();
  });
});
