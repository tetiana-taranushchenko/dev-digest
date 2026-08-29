import { ContextView } from "./_components/ContextView";

/* Legacy compatibility route. Canonical navigation is repo-scoped at
   /repos/:repoId/context; this entry keeps older saved /context links working
   by using the active repo from RepoProvider inside ContextView. */
export default function ContextPage() {
  return <ContextView />;
}
