import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

function pr(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr1",
    number: 42,
    title: "Add rate limiting",
    author: "marisa.koch",
    branch: "feat/rate-limit",
    base: "main",
    head_sha: "abc123",
    additions: 10,
    deletions: 5,
    files_count: 2,
    status: "needs_review",
    opened_at: "2026-06-10T00:00:00.000Z",
    updated_at: "2026-06-11T00:00:00.000Z",
    score: 85,
    cost_usd: 0.01,
    findings_by_severity: null,
    top_findings: null,
    ...o,
  };
}

function renderRow(p: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={p} repoId="repo1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — FINDINGS column", () => {
  it("shows a muted dash when there are no findings", () => {
    renderRow(pr({ findings_by_severity: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 } }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows a muted dash when findings_by_severity is absent (never reviewed)", () => {
    renderRow(pr({ findings_by_severity: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows one badge per non-zero severity, skipping zero counts", () => {
    renderRow(pr({ findings_by_severity: { CRITICAL: 2, WARNING: 0, SUGGESTION: 1 } }));
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("hovering the findings badges opens a popup listing the top findings", () => {
    renderRow(
      pr({
        findings_by_severity: { CRITICAL: 1, WARNING: 0, SUGGESTION: 0 },
        top_findings: [
          {
            id: "f1",
            severity: "CRITICAL",
            category: "security",
            title: "Hardcoded Stripe secret key",
            file: "src/config.ts",
            start_line: 12,
            end_line: 12,
            rationale: "A live secret is committed.",
            confidence: 0.98,
          },
        ],
      }),
    );
    fireEvent.mouseEnter(screen.getByText("1").closest("div")!);
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });
});
