import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, EvalCase, EvalCaseInput, EvalRunResult, Skill } from "@devdigest/shared";
import evalMessages from "../../../../messages/en/eval.json";
import commonMessages from "../../../../messages/en/common.json";

const EXISTING_CASE: EvalCase = {
  id: "case-1",
  owner_kind: "agent",
  owner_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts",
  input_files: null,
  input_meta: { title: "Add Stripe integration", body: "Wire up payments." },
  expected_output: [
    { severity: "CRITICAL", category: "security", title: "Hardcoded key", file: "src/config.ts", start_line: 12, end_line: 12 },
  ],
  notes: null,
};

const createMutateAsync = vi.fn();
const updateMutateAsync = vi.fn();
const runMutateAsync = vi.fn();

vi.mock("../../../lib/hooks/eval", () => ({
  useEvalCase: (id: string | null | undefined) => ({
    data: id === EXISTING_CASE.id ? EXISTING_CASE : undefined,
  }),
  useCreateEvalCase: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useUpdateEvalCase: () => ({ mutateAsync: updateMutateAsync, isPending: false }),
  useRunEvalCase: () => ({ mutateAsync: runMutateAsync, isPending: false }),
}));

const AGENTS: Agent[] = [
  {
    id: "ag1",
    name: "Security Reviewer",
    description: "",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    enabled: true,
    version: 1,
  },
];
const SKILLS: Skill[] = [];

vi.mock("../../../lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS }),
}));
vi.mock("../../../lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS }),
}));

import { EvalCaseEditor, type EvalCaseEditorProps } from "./EvalCaseEditor";

function renderEditor(props: Partial<EvalCaseEditorProps> = {}) {
  const qc = new QueryClient();
  const onClose = props.onClose ?? vi.fn();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages, common: commonMessages }}>
        <EvalCaseEditor {...props} onClose={onClose} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const SEEDED_INPUT: EvalCaseInput = {
  owner_kind: "agent",
  owner_id: "ag1",
  name: "must-find-hardcoded-key",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -10,6 +10,7 @@\n+  stripeKey: \"sk_live_...\"",
  input_files: null,
  input_meta: null,
  expected_output: [
    { severity: "CRITICAL", category: "security", title: "Hardcoded key", file: "src/config.ts", start_line: 12, end_line: 12 },
  ],
  notes: null,
};

/**
 * `getByDisplayValue`/`getByPlaceholderText` normalize whitespace in a way
 * that breaks on multi-line diff/JSON text (collapses embedded newlines,
 * so an exact multi-line query never matches even when the raw `.value`
 * is identical — a jsdom/testing-library quirk, not a component bug).
 * Textareas render in a fixed order — the active Input-tab textarea (Diff,
 * Files, or PR meta's Body) always precedes the Expected output one — so
 * index into them and assert `.value` directly with `toHaveValue`.
 *
 * Queries `document.body` rather than RTL's `container`: the Modal portals
 * its content to `document.body` (fixes it being clipped by any ancestor
 * with `overflow: hidden`), so it renders as a sibling of `container`, not
 * a descendant.
 */
function getTextareas(): HTMLTextAreaElement[] {
  return Array.from(document.body.querySelectorAll("textarea"));
}

afterEach(() => {
  cleanup();
  createMutateAsync.mockReset();
  updateMutateAsync.mockReset();
  runMutateAsync.mockReset();
});

describe("EvalCaseEditor", () => {
  it("renders Diff / Files / PR meta input views and an Expected output editor", () => {
    renderEditor({ seed: SEEDED_INPUT });

    // Expected output editor is present with a valid-JSON indicator.
    expect(screen.getByText(evalMessages.caseEditor.expectedOutput)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.caseEditor.validJson)).toBeInTheDocument();

    // Diff view is active by default, showing the seeded diff text.
    expect(getTextareas()[0]).toHaveValue(SEEDED_INPUT.input_diff);

    // Switching to Files clears that textarea's value (its own, empty `input_files`).
    fireEvent.click(screen.getByRole("button", { name: evalMessages.caseEditor.tabs.files }));
    expect(getTextareas()[0]).toHaveValue("");

    // Switching to PR meta shows the structured Title/Body fields.
    fireEvent.click(screen.getByRole("button", { name: evalMessages.caseEditor.tabs.prMeta }));
    expect(screen.getByText(evalMessages.caseEditor.titleLabel)).toBeInTheDocument();
    expect(screen.getByText(evalMessages.caseEditor.bodyLabel)).toBeInTheDocument();
  });

  it("marks invalid JSON in Expected output and blocks Save", () => {
    renderEditor({ seed: SEEDED_INPUT });

    // Diff tab is active by default — index 1 is the Expected output textarea.
    const expectedTextarea = getTextareas()[1]!;
    fireEvent.change(expectedTextarea, { target: { value: "{not valid json" } });

    // Badge + inline alert both announce the invalid state.
    expect(screen.getAllByText(evalMessages.caseEditor.invalidJson).length).toBeGreaterThan(0);
    const saveButton = screen.getByRole("button", { name: evalMessages.caseEditor.save });
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("blocks Save and prompts for an owner when owner_id is empty", () => {
    renderEditor();

    expect(screen.getByText(evalMessages.caseEditor.ownerRequired)).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: evalMessages.caseEditor.save });
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("pre-fills from a passed-in seed prop", () => {
    renderEditor({ seed: SEEDED_INPUT });

    expect(screen.getByDisplayValue(SEEDED_INPUT.name)).toBeInTheDocument();
    const textareas = getTextareas();
    expect(textareas[0]).toHaveValue(SEEDED_INPUT.input_diff);
    expect(textareas[1]).toHaveValue(JSON.stringify(SEEDED_INPUT.expected_output, null, 2));
    // Owner is already resolved from the seed — no owner prompt.
    expect(screen.queryByText(evalMessages.caseEditor.ownerRequired)).not.toBeInTheDocument();
  });

  it("Run on save executes the case and shows its outcome inline", async () => {
    const savedCase: EvalCase = { ...EXISTING_CASE, id: "new-case-1", name: "must-find-hardcoded-key" };
    createMutateAsync.mockResolvedValue(savedCase);
    const runResult: EvalRunResult = {
      run_id: "run-1",
      case_id: "new-case-1",
      result: {
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        traces_passed: 1,
        traces_total: 1,
        duration_ms: 1800,
        cost_usd: 0.02,
        per_trace: [],
      },
    };
    runMutateAsync.mockResolvedValue(runResult);

    renderEditor({ seed: SEEDED_INPUT });

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: evalMessages.caseEditor.save }));

    await waitFor(() => expect(createMutateAsync).toHaveBeenCalledTimes(1));
    expect(runMutateAsync).toHaveBeenCalledWith("new-case-1");

    expect(await screen.findByText(evalMessages.caseEditor.lastRunPassed)).toBeInTheDocument();
    expect(
      screen.getByText(
        evalMessages.caseEditor.resultSummary
          .replace("{recall}", "100")
          .replace("{precision}", "100")
          .replace("{citation}", "100")
          .replace("{duration}", "1.8"),
      ),
    ).toBeInTheDocument();
  });
});
