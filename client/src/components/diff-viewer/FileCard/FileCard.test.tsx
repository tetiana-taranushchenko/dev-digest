import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import shellMessages from "../../../../messages/en/shell.json";

import { FileCard } from "./FileCard";
import { AUTO_EXPAND_MAX_LINES, LARGE_FILE_CHANGED_LINES } from "../constants";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>{ui}</NextIntlClientProvider>);
}

function makeFile(overrides: Partial<PrFile> = {}): PrFile {
  return {
    path: "src/example.ts",
    additions: 1,
    deletions: 0,
    patch: "@@ -1,2 +1,2 @@\n context line\n+added line",
    ...overrides,
  };
}

describe("FileCard", () => {
  it("auto-expands when the diff is within AUTO_EXPAND_MAX_LINES and stays collapsed above it", () => {
    const small = makeFile({ additions: 1, deletions: 0 });
    renderWithIntl(<FileCard file={small} />);
    expect(screen.getByText("added line")).toBeInTheDocument();

    cleanup();
    const large = makeFile({ additions: AUTO_EXPAND_MAX_LINES + 1, deletions: 0 });
    renderWithIntl(<FileCard file={large} />);
    expect(screen.queryByText("added line")).not.toBeInTheDocument();

    // The user can still open it manually via the header.
    fireEvent.click(screen.getByText("src/example.ts"));
    expect(screen.getByText("added line")).toBeInTheDocument();
  });

  it("defaultOpen overrides the size-based auto-expand rule in both directions", () => {
    // Small file, but forced closed.
    const small = makeFile({ additions: 1, deletions: 0 });
    renderWithIntl(<FileCard file={small} defaultOpen={false} />);
    expect(screen.queryByText("added line")).not.toBeInTheDocument();

    cleanup();
    // Large file, but forced open.
    const large = makeFile({ additions: AUTO_EXPAND_MAX_LINES + 1, deletions: 0 });
    renderWithIntl(<FileCard file={large} defaultOpen={true} />);
    expect(screen.getByText("added line")).toBeInTheDocument();
  });

  it("renders findings only on the matching new-side row", () => {
    const file = makeFile({
      additions: 2,
      deletions: 0,
      patch: "@@ -1,3 +1,3 @@\n context line\n+first added\n+second added",
    });
    renderWithIntl(
      <FileCard
        file={file}
        findingsByLine={new Map([[2, [{ id: "finding-1", severity: "WARNING", title: "Risk" }]]])}
      />,
    );

    const findingRow = document.querySelector('[data-diff-line="src/example.ts:2"]');
    const otherRow = document.querySelector('[data-diff-line="src/example.ts:3"]');
    expect(findingRow).toBeInTheDocument();
    expect(otherRow).toBeInTheDocument();
    expect(findingRow?.querySelector("button")).toHaveTextContent("warning");
    expect(otherRow?.querySelector("button")).toBeNull();
  });

  it("keeps 150 changed lines normal and marks 151 large", () => {
    const boundary = makeFile({ additions: LARGE_FILE_CHANGED_LINES, deletions: 0 });
    renderWithIntl(
      <FileCard
        file={boundary}
        emphasizeLarge
        largeFileLabel="Large file"
        largeFileAriaLabel="Large file src/example.ts: 150 changed lines"
      />,
    );
    expect(screen.queryByText("Large file")).not.toBeInTheDocument();

    cleanup();
    const over = makeFile({ additions: LARGE_FILE_CHANGED_LINES + 1, deletions: 0 });
    renderWithIntl(
      <FileCard
        file={over}
        emphasizeLarge
        largeFileLabel="Large file"
        largeFileAriaLabel="Large file src/example.ts: 151 changed lines"
      />,
    );
    expect(screen.getByLabelText("Large file src/example.ts: 151 changed lines")).toHaveTextContent("Large file");
    expect(screen.getByText("src/example.ts")).toHaveStyle({ color: "var(--warn)" });
  });

  it("counts only findings whose new-side rows are rendered by the patch", () => {
    renderWithIntl(
      <FileCard
        file={makeFile()}
        findingsByLine={new Map([
          [2, [{ id: "visible", severity: "WARNING", title: "Visible risk" }]],
          [99, [{ id: "missing", severity: "CRITICAL", title: "Missing row risk" }]],
        ])}
        findingCountLabel={(count) => `${count} finding`}
      />,
    );

    expect(screen.getByText("1 finding").tagName).toBe("SPAN");
    expect(screen.queryByTitle("Missing row risk")).not.toBeInTheDocument();
  });
});
