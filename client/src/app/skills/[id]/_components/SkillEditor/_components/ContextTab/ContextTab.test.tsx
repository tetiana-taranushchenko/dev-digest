import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AttachedContextDoc, ContextListing, Skill } from "@devdigest/shared";
import skillsMessages from "../../../../../../../../messages/en/skills.json";
import contextMessages from "../../../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../../../lib/toast";

const FILES: ContextListing = {
  files: [
    { path: "docs/architecture.md", content: null, size: 1200, updated_at: null, source: "docs", tokens: 100, used_by: 1 },
    { path: "specs/prd.md", content: null, size: 800, updated_at: null, source: "spec", tokens: 200, used_by: 1 },
  ],
  index: { status: "done", pct: 100, message: null, chunks_indexed: 2, doc_count: 2, refreshed_at: null, unavailable_reason: null },
};

vi.mock("../../../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "repo-1" }),
}));

vi.mock("../../../../../../../lib/hooks/core", () => ({
  useContextFiles: () => ({ data: FILES, isLoading: false, isError: false }),
}));

// This skill's own attachment — `specs/prd.md` is attached to a DIFFERENT
// skill and must NOT appear here or count toward this skill's total (AC-10,
// second clause: the skill total is that skill's own set only).
const THIS_SKILL_CONTEXT: AttachedContextDoc[] = [
  { path: "docs/architecture.md", source: "docs", tokens: 100, resolved: true },
];

const setContextMutate = vi.fn();

vi.mock("../../../../../../../lib/hooks/skills", () => ({
  useSkillContext: () => ({ data: THIS_SKILL_CONTEXT, isLoading: false, isError: false }),
  useSetSkillContext: () => ({ mutate: setContextMutate, isPending: false }),
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  setContextMutate.mockClear();
});

const SKILL: Skill = {
  id: "sk1",
  name: "Security basics",
  description: "",
  type: "security",
  source: "manual",
  body: "",
  enabled: true,
  version: 1,
  evidence_files: null,
  injection_flagged: false,
  injection_reason: null,
};

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages, context: contextMessages }}>
        {ui}
      </NextIntlClientProvider>
    </ToastProvider>,
  );
}

describe("ContextTab (skills, smoke)", () => {
  it("shows only this skill's own attached documents and posts paths only on toggle (AC-10, AC-7)", async () => {
    renderWithProviders(<ContextTab skill={SKILL} />);

    // Total is this skill's own 100 tokens only — `specs/prd.md` (attached to
    // another skill, per THIS_SKILL_CONTEXT not including it) is NOT counted.
    await waitFor(() => expect(screen.getByText("100 tokens total")).toBeInTheDocument());
    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    // Still listed as an available (unattached) document, but not attached here.
    expect(screen.getByText("prd.md")).toBeInTheDocument();

    const row = screen.getByText("architecture.md").closest("div")!;
    const checkbox = row.querySelector('[role="checkbox"]')!;
    fireEvent.click(checkbox);

    expect(setContextMutate).toHaveBeenCalledTimes(1);
    const [args] = setContextMutate.mock.calls[0]!;
    expect(args).toEqual({ skillId: "sk1", paths: [] });
    expect(Object.keys(args)).toEqual(["skillId", "paths"]);
  });
});
