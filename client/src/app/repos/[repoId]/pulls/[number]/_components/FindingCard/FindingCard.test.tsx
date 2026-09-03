import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseInput, FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

const SEED: EvalCaseInput = {
  owner_kind: "agent",
  owner_id: "ag1",
  name: "must-find-hardcoded-stripe-secret-key",
  input_diff: "--- a/src/config.ts\n+++ b/src/config.ts",
  input_files: null,
  input_meta: null,
  expected_output: [
    {
      severity: "CRITICAL",
      category: "security",
      title: "Hardcoded Stripe secret key",
      file: "src/config.ts",
      start_line: 11,
    },
  ],
  notes: null,
};

const seedMutate = vi.fn(
  (findingId: string, opts?: { onSuccess?: (seed: EvalCaseInput) => void }) => {
    opts?.onSuccess?.(SEED);
  },
);

vi.mock("../../../../../../../lib/hooks/eval", () => ({
  useEvalSeed: () => ({ mutate: seedMutate, isPending: false }),
}));

vi.mock("../../../../../../../components/eval-case-editor/EvalCaseEditor", () => ({
  EvalCaseEditor: ({ seed, onClose }: { seed: EvalCaseInput; onClose: () => void }) => (
    <div data-testid="eval-case-editor">
      <span>{seed.name}</span>
      <pre>{JSON.stringify(seed.expected_output)}</pre>
      <button onClick={onClose}>close editor</button>
    </div>
  ),
}));

import { FindingCard } from "./FindingCard";

afterEach(() => {
  cleanup();
  seedMutate.mockClear();
});

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });

  it('activating "Turn into eval case" requests a seed and opens the editor pre-filled', () => {
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);

    expect(screen.queryByTestId("eval-case-editor")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Turn into eval case"));

    // The seed mutation fires with the finding's id, not routed through onAction.
    expect(seedMutate).toHaveBeenCalledWith("f1", expect.any(Object));

    // The editor opens pre-filled with the seed's returned name/expected_output.
    const editor = screen.getByTestId("eval-case-editor");
    expect(editor).toHaveTextContent(SEED.name);
    expect(editor).toHaveTextContent(JSON.stringify(SEED.expected_output));
  });
});
