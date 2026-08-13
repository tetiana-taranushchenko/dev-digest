/* SeverityCounters — CRITICAL / WARNING / SUGGESTION chips above the review
   runs list. Clicking a chip filters findings shown in every open run's
   FindingsPanel down to that severity; clicking the active chip clears it. */
"use client";

import React from "react";
import { Chip, SEV } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";
import { SEVERITY_ORDER, tallySeverity } from "@/lib/severity";
import { s } from "./styles";

export function SeverityCounters({
  findings,
  selected,
  onSelect,
}: {
  findings: FindingRecord[];
  selected: Severity | null;
  onSelect: (severity: Severity | null) => void;
}) {
  const counts = React.useMemo(() => tallySeverity(findings), [findings]);

  return (
    <div style={s.severityCounters}>
      {SEVERITY_ORDER.map((severity) => (
        <Chip
          key={severity}
          active={selected === severity}
          icon={SEV[severity].icon}
          color={SEV[severity].c}
          count={counts[severity]}
          onClick={() => onSelect(selected === severity ? null : severity)}
        >
          {SEV[severity].label.toUpperCase()}
        </Chip>
      ))}
    </div>
  );
}
