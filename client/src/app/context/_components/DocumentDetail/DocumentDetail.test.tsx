import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ContextDocument } from "@devdigest/shared";
import contextMessages from "../../../../../messages/en/context.json";
import type { DocumentDetailProps } from "../ContextView/types";
import { DocumentDetail } from "./DocumentDetail";

const document: ContextDocument = {
  path: "docs/security.md",
  content: "safe",
  size: 4,
  updated_at: "2026-08-29T10:00:00.000Z",
  source: "docs",
  tokens: 1,
  used_by: 3,
  revision: "rev-1",
  writable: false,
};

function props(overrides: Partial<DocumentDetailProps> = {}): DocumentDetailProps {
  return {
    selectedPath: document.path,
    document,
    isDocLoading: false,
    isDocError: false,
    docErrorMessage: null,
    mode: "preview",
    setMode: vi.fn(),
    draft: document.content,
    setDraft: vi.fn(),
    isDirty: false,
    discardDraft: vi.fn(),
    save: vi.fn(),
    isSaving: false,
    saveOutcome: null,
    conflict: false,
    reloadFromDisk: vi.fn(),
    ...overrides,
  };
}

function renderDetail(overrides: Partial<DocumentDetailProps> = {}) {
  const allProps = props(overrides);
  render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <DocumentDetail {...allProps} />
    </NextIntlClientProvider>,
  );
  return allProps;
}

afterEach(cleanup);

describe("DocumentDetail", () => {
  it("renders untrusted markdown without executable HTML, event handlers, or javascript links", () => {
    const malicious = [
      "# Security",
      "<script>window.__owned = true</script>",
      '<img src=x onerror="window.__owned = true">',
      "[danger](javascript:alert(1))",
    ].join("\n\n");
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <DocumentDetail {...props({ document: { ...document, content: malicious } })} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });

  it("shows a useful placeholder when no document is selected", () => {
    renderDetail({ selectedPath: null, document: undefined });
    expect(screen.getByText(contextMessages.detail.placeholder)).toBeInTheDocument();
  });

  it("isolates a document load error and offers retry", () => {
    const reloadFromDisk = vi.fn();
    renderDetail({ document: undefined, isDocError: true, docErrorMessage: "Disk read failed", reloadFromDisk });

    expect(screen.getByText("Disk read failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(reloadFromDisk).toHaveBeenCalledOnce();
  });
});
