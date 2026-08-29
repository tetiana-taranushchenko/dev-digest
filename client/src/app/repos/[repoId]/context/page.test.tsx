import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-42" }),
}));

vi.mock("../../../context/_components/ContextView", () => ({
  ContextView: ({ repoId }: { repoId?: string }) => <div>Context for {repoId}</div>,
}));

import RepoContextPage from "./page";

afterEach(cleanup);

describe("RepoContextPage", () => {
  it("passes the repo id from the canonical route to ContextView", () => {
    render(<RepoContextPage />);

    expect(screen.getByText("Context for repo-42")).toBeInTheDocument();
  });
});
