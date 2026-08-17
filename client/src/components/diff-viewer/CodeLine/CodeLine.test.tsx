import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Line } from "../helpers";

import { CodeLine } from "./CodeLine";

afterEach(cleanup);

describe("CodeLine", () => {
  it("renders no finding controls and keeps the plain row style when annotations are absent", () => {
    const ln: Line = { kind: "add", text: "added text", newNo: 4 };
    render(<CodeLine ln={ln} path="src/example.ts" threads={[]} />);

    expect(screen.getByText("added text")).toBeInTheDocument();
    const row = document.querySelector('[data-diff-line="src/example.ts:4"]') as HTMLElement;
    const inner = row.firstElementChild as HTMLElement;
    expect(inner.style.background).toBe("var(--code-add)");
    expect(inner.style.borderLeft).toBe("");
    expect(screen.queryByRole("button", { name: /finding at/ })).not.toBeInTheDocument();
  });

  it("renders one accessible control per finding and uses the worst severity tint", () => {
    const ln: Line = { kind: "ctx", text: "context text", oldNo: 4, newNo: 4 };
    const onFindingClick = vi.fn();
    render(
      <CodeLine
        ln={ln}
        path="src/example.ts"
        threads={[]}
        findings={[
          { id: "suggestion-1", severity: "SUGGESTION", title: "Try a clearer name" },
          { id: "critical-1", severity: "CRITICAL", title: "Secret exposed" },
        ]}
        onFindingClick={onFindingClick}
      />,
    );

    const row = document.querySelector('[data-diff-line="src/example.ts:4"]') as HTMLElement;
    const inner = row.firstElementChild as HTMLElement;
    expect(inner.style.background).toBe("var(--crit-bg)");
    expect(inner.style.borderLeft).toBe("2px solid var(--crit)");

    const suggestion = screen.getByRole("button", {
      name: "Open suggestion finding at src/example.ts:4",
    });
    const critical = screen.getByRole("button", {
      name: "Open critical finding at src/example.ts:4",
    });
    expect(suggestion).toHaveTextContent("suggestion");
    expect(critical).toHaveTextContent("critical");

    fireEvent.click(critical);
    expect(onFindingClick).toHaveBeenCalledTimes(1);
    expect(onFindingClick).toHaveBeenCalledWith("critical-1");
  });

  it("only sets data-diff-line when the line has a new-side number", () => {
    const added: Line = { kind: "add", text: "added text", newNo: 7 };
    const { unmount } = render(<CodeLine ln={added} path="src/example.ts" threads={[]} />);
    expect(document.querySelector('[data-diff-line="src/example.ts:7"]')).toBeInTheDocument();
    unmount();

    // A pure deletion has no new-side line number.
    const deleted: Line = { kind: "del", text: "removed text", oldNo: 9 };
    render(<CodeLine ln={deleted} path="src/example.ts" threads={[]} />);
    expect(screen.getByText("removed text")).toBeInTheDocument();
    expect(document.querySelector("[data-diff-line]")).not.toBeInTheDocument();
  });
});
