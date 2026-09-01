"use client";

import React from "react";
import { NO_SNAPSHOT_MESSAGE, versionLegend } from "../constants";
import { diffWords } from "../helpers";
import { s } from "../styles";

/**
 * SystemPromptDiff — AC-34's word-level system-prompt diff between the two
 * matched agent version snapshots, mirrors the design reference's word-diff
 * rendering (`screen_skills-eval-dashboard-compare-modal.jsx:331-340`).
 *
 * `key={i}` on the token spans is a deliberate, narrow exception to the
 * "never use array index as key" rule: `tokens` is a fresh, fully-derived
 * array from a pure function on every render (never reordered/filtered in
 * place independent of its source text), so there is no stable per-token
 * identity to key on — same reasoning the design reference itself applies.
 */
export function SystemPromptDiff({
  oldPrompt,
  newPrompt,
  oldVersion,
  newVersion,
  hasBothSnapshots,
}: {
  oldPrompt: string;
  newPrompt: string;
  oldVersion: number | undefined;
  newVersion: number | undefined;
  hasBothSnapshots: boolean;
}) {
  if (!hasBothSnapshots) {
    return <p style={s.noSnapshot}>{NO_SNAPSHOT_MESSAGE}</p>;
  }

  const tokens = diffWords(oldPrompt, newPrompt);

  return (
    <>
      <div style={s.legendRow}>
        <span style={s.legendItem}>
          <span style={{ ...s.legendSwatch, background: "var(--code-del)" }} />
          {versionLegend(oldVersion, "old")}
        </span>
        <span style={s.legendItem}>
          <span style={{ ...s.legendSwatch, background: "var(--code-add)" }} />
          {versionLegend(newVersion, "new")}
        </span>
      </div>
      <div style={s.diffBox}>
        {tokens.map((tk, i) => (
          // eslint-disable-next-line react/no-array-index-key -- see file docstring
          <span
            key={i}
            style={{
              background: tk.kind === "add" ? "var(--code-add)" : tk.kind === "del" ? "var(--code-del)" : "transparent",
              color: tk.kind === "same" ? "var(--text-secondary)" : tk.kind === "add" ? "var(--code-add-text)" : "var(--code-del-text)",
              textDecoration: tk.kind === "del" ? "line-through" : "none",
            }}
          >
            {tk.text}
          </span>
        ))}
      </div>
    </>
  );
}
