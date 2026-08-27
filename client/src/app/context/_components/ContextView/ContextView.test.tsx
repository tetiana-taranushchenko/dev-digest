import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SpecFile, ContextListing } from "@devdigest/shared";
import contextMessages from "../../../../../messages/en/context.json";
import commonMessages from "../../../../../messages/en/common.json";

const mutate = vi.fn();

let repoId: string | null = "repo-1";
let queryData: ContextListing | undefined;
let isLoading = false;
let isError = false;

vi.mock("../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId, reposLoaded: true }),
}));

vi.mock("../../../../lib/hooks/core", () => ({
  useContextFiles: () => ({
    data: queryData,
    isLoading,
    isError,
    error: null,
    refetch: vi.fn(),
  }),
  useReindexContext: () => ({ mutate, isPending: false }),
}));

import { ContextView } from "./ContextView";

function file(o: Partial<SpecFile>): SpecFile {
  return {
    path: "docs/architecture.md",
    content: null,
    size: 1200,
    updated_at: null,
    source: "docs",
    tokens: 340,
    used_by: 2,
    ...o,
  };
}

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages, common: commonMessages }}>
      <ContextView />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mutate.mockClear();
  repoId = "repo-1";
  queryData = undefined;
  isLoading = false;
  isError = false;
});

describe("ContextView — empty state (AC-2)", () => {
  it("renders the exact context.json empty.title/empty.body copy when nothing is discovered", () => {
    queryData = {
      files: [],
      index: { status: "done", pct: 100, message: null, chunks_indexed: 0, doc_count: 0, refreshed_at: null, unavailable_reason: null },
    };
    renderView();

    expect(screen.getByText(contextMessages.empty.title)).toBeInTheDocument();
    expect(screen.getByText(contextMessages.empty.body)).toBeInTheDocument();
  });
});

describe("ContextView — document listing (AC-1) and reindex (AC-4)", () => {
  it("lists file name, folder, source, token estimate, and used-by count, and triggers reindex without a full reload", () => {
    queryData = {
      files: [file({ path: "docs/architecture.md", source: "docs", tokens: 340, used_by: 2 })],
      index: { status: "done", pct: 100, message: null, chunks_indexed: 5, doc_count: 1, refreshed_at: "2026-08-20T10:00:00.000Z", unavailable_reason: null },
    };
    renderView();

    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.getByText("340 tok")).toBeInTheDocument();
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
    expect(screen.getByText(/Index status: done/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /re-index/i }));
    expect(mutate).toHaveBeenCalledWith("repo-1");
  });
});

describe("ContextView — index-unavailable state (AC-5)", () => {
  it("shows the unavailable-index cause instead of an empty document list when the clone is missing", () => {
    queryData = {
      files: [],
      index: { status: "error", pct: 0, message: null, chunks_indexed: null, doc_count: 0, refreshed_at: null, unavailable_reason: "Repo clone not found on disk" },
    };
    renderView();

    expect(screen.getByRole("alert")).toHaveTextContent("Repo clone not found on disk");
    expect(screen.queryByText(contextMessages.empty.title)).not.toBeInTheDocument();
  });
});
