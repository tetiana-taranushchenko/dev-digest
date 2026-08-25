import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile } from "@devdigest/shared";
import shellMessages from "../../../../messages/en/shell.json";

import { DiffViewer } from "./DiffViewer";
import { AUTO_EXPAND_MAX_LINES } from "../constants";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={{ shell: shellMessages }}>{ui}</NextIntlClientProvider>);
}

describe("DiffViewer", () => {
  it("shows the no-changed-files empty state when there are no files", () => {
    renderWithIntl(<DiffViewer files={[]} />);
    expect(screen.getByText("No changed files.")).toBeInTheDocument();
  });

  it("renders a FileCard per changed file", () => {
    const files: PrFile[] = [
      { path: "src/a.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+line a" },
      { path: "src/b.ts", additions: 1, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+line b" },
    ];

    renderWithIntl(<DiffViewer files={files} />);

    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("src/b.ts")).toBeInTheDocument();
    // Both diffs are small enough to auto-expand.
    expect(screen.getByText("line a")).toBeInTheDocument();
    expect(screen.getByText("line b")).toBeInTheDocument();
  });

  it("applies large-file emphasis only when explicitly enabled", () => {
    const files: PrFile[] = [
      { path: "src/large.ts", additions: 151, deletions: 0, patch: "@@ -0,0 +1,1 @@\n+line" },
    ];

    renderWithIntl(<DiffViewer files={files} />);
    expect(screen.queryByText("Large file")).not.toBeInTheDocument();

    cleanup();
    renderWithIntl(
      <DiffViewer
        files={files}
        emphasizeLargeFiles
        largeFileLabel="Large file"
        largeFileAriaLabel={(file, lines) => `Large file ${file.path}: ${lines} changed lines`}
      />,
    );
    expect(screen.getByLabelText("Large file src/large.ts: 151 changed lines")).toBeInTheDocument();
  });

  it("forces open only the file matching targetFile, leaving other large files collapsed", () => {
    const files: PrFile[] = [
      {
        path: "src/target-large.ts",
        additions: AUTO_EXPAND_MAX_LINES + 1,
        deletions: 0,
        patch: "@@ -0,0 +1,1 @@\n+target line",
      },
      {
        path: "src/other-large.ts",
        additions: AUTO_EXPAND_MAX_LINES + 1,
        deletions: 0,
        patch: "@@ -0,0 +1,1 @@\n+other line",
      },
    ];

    renderWithIntl(<DiffViewer files={files} targetFile="src/target-large.ts" />);

    // The targeted file's lines render even though it's above the auto-expand threshold.
    expect(screen.getByText("target line")).toBeInTheDocument();
    // The other large file, not matching targetFile, stays collapsed.
    expect(screen.queryByText("other line")).not.toBeInTheDocument();
  });
});
