import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AttachedContextDoc, SpecFile } from "@devdigest/shared";
import contextMessages from "../../../messages/en/context.json";

let documentBody = "# Architecture\nSafe preview";

vi.mock("../../lib/hooks/core", () => ({
  useContextDocument: (_repoId: string, path: string | null) => ({
    data: path ? { content: documentBody } : undefined,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

import { ContextDocPicker } from "./ContextDocPicker";

const documents: SpecFile[] = [
  {
    path: "docs/architecture.md",
    content: null,
    size: 100,
    updated_at: null,
    source: "docs",
    tokens: 3500,
    used_by: 2,
  },
  {
    path: "specs/security.md",
    content: null,
    size: 80,
    updated_at: null,
    source: "spec",
    tokens: 1200,
    used_by: 1,
  },
];

function renderPicker(options: { attached?: AttachedContextDoc[]; onChange?: (paths: string[]) => void; mapReduce?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ContextDocPicker
        repoId="repo-1"
        documents={documents}
        attached={options.attached ?? []}
        onChange={options.onChange ?? vi.fn()}
        tokenCap={4000}
        mapReduce={options.mapReduce}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  documentBody = "# Architecture\nSafe preview";
});

describe("ContextDocPicker", () => {
  it("supports focusable attach controls, preview toggle, Escape close, and focus restoration", async () => {
    const onChange = vi.fn();
    renderPicker({ onChange });

    const firstCheckbox = screen.getAllByRole("checkbox")[0]!;
    firstCheckbox.focus();
    expect(firstCheckbox).toHaveFocus();
    fireEvent.click(firstCheckbox);
    expect(onChange).toHaveBeenCalledWith(["docs/architecture.md"]);

    const previewButton = screen.getAllByRole("button", { name: contextMessages.picker.preview })[0]!;
    previewButton.focus();
    fireEvent.click(previewButton);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Safe preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: contextMessages.picker.attach })).toBeInTheDocument();
    // jsdom has no layout, so every button's offsetParent is null and the
    // focus-trap deliberately falls back to its focusable wrapper. A browser
    // focuses the first visible control instead.
    expect(screen.getByRole("dialog").parentElement?.parentElement).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog").parentElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(previewButton).toHaveFocus();
  });

  it("announces an over-budget state with text and explains map-reduce repetition", () => {
    renderPicker({
      attached: documents.map((doc) => ({
        path: doc.path,
        source: doc.source,
        tokens: doc.tokens,
        resolved: true,
      })),
      mapReduce: true,
    });

    expect(screen.getByText(contextMessages.picker.overCapLabel)).toBeInTheDocument();
    expect(screen.getByText(contextMessages.picker.overCapHint.replace("{cap}", "4000"))).toBeInTheDocument();
    expect(screen.getByText(contextMessages.picker.mapReduceNote)).toBeInTheDocument();
  });

  it("toggles an attached document from the preview drawer", () => {
    const onChange = vi.fn();
    renderPicker({
      attached: [{ path: "docs/architecture.md", source: "docs", tokens: 3500, resolved: true }],
      onChange,
    });

    fireEvent.click(screen.getAllByRole("button", { name: contextMessages.picker.preview })[0]!);
    fireEvent.click(screen.getByRole("button", { name: contextMessages.picker.attached }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
