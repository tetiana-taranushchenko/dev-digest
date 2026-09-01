"use client";

import React from "react";
import type { EvalOwnerKind } from "@devdigest/shared";
import { EvalOverview } from "./_components/EvalOverview";
import { EvalOwnerDetail } from "./_components/EvalOwnerDetail";

/* Route: /eval (Eval Dashboard). Thin route entry — the view, its
   confirmation dialog, styles, constants and helpers are colocated under
   _components/EvalOverview (T12) and _components/EvalOwnerDetail (T13).
   This file owns the one piece of state shared between the two: which
   owner (if any) is selected. The plan's dependency graph left this
   integration point unowned (T12 deliberately shipped `OwnerRow` with no
   click handler; T13's plan brief explicitly authorized wiring it here) —
   selecting a row swaps the overview for the owner's detail view (AC-32);
   "All agents" clears the selection back. Reachable from the existing
   SKILLS LAB → "Eval Dashboard" nav entry (client/src/vendor/ui/nav.ts:35,
   untouched — AC-35). */
export default function EvalPage() {
  const [selectedOwner, setSelectedOwner] = React.useState<{ ownerKind: EvalOwnerKind; ownerId: string } | null>(
    null,
  );

  if (selectedOwner) {
    return (
      <EvalOwnerDetail
        ownerKind={selectedOwner.ownerKind}
        ownerId={selectedOwner.ownerId}
        onBack={() => setSelectedOwner(null)}
      />
    );
  }

  return (
    <EvalOverview onSelectOwner={(ownerKind, ownerId) => setSelectedOwner({ ownerKind, ownerId })} />
  );
}
