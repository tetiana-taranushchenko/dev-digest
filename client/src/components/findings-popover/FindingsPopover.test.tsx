import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import type { Finding } from "@devdigest/shared";
import { FindingsPopover } from "./FindingsPopover";

afterEach(cleanup);

const FINDING: Finding = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded secret",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "A secret is committed.",
  confidence: 0.95,
};

function anchorFor(text: string) {
  return screen.getByText(text).closest("div")!;
}

describe("FindingsPopover", () => {
  it("shows the findings list on hover", () => {
    render(<FindingsPopover trigger={<span>trigger</span>} items={[FINDING]} total={1} />);
    fireEvent.mouseEnter(anchorFor("trigger"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("does not open when there are no items, even on hover", () => {
    render(<FindingsPopover trigger={<span>trigger</span>} items={[]} total={0} />);
    fireEvent.mouseEnter(anchorFor("trigger"));
    expect(screen.queryByText(/finding/)).not.toBeInTheDocument();
  });

  it("closes after the mouse leaves, but not instantly", () => {
    vi.useFakeTimers();
    try {
      render(<FindingsPopover trigger={<span>trigger</span>} items={[FINDING]} total={1} />);
      const anchor = anchorFor("trigger");
      fireEvent.mouseEnter(anchor);
      expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();

      fireEvent.mouseLeave(anchor);
      // Still open right after leaving — closing is delayed so the mouse has
      // time to reach the popup itself (it renders in a portal, outside the
      // trigger's DOM subtree).
      expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a custom heading when provided", () => {
    render(
      <FindingsPopover trigger={<span>trigger</span>} items={[FINDING]} total={1} heading="1 finding in this run" />,
    );
    fireEvent.mouseEnter(anchorFor("trigger"));
    expect(screen.getByText("1 finding in this run")).toBeInTheDocument();
  });
});
