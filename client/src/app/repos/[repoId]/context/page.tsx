/* Canonical repo-scoped Project Context route: /repos/:repoId/context. */
"use client";

import { useParams } from "next/navigation";
import { ContextView } from "../../../context/_components/ContextView";

export default function RepoContextPage() {
  const { repoId } = useParams<{ repoId: string }>();

  return <ContextView repoId={repoId} />;
}
