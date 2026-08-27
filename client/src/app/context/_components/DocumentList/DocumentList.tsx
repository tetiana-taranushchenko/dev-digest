/* DocumentList — the left pane of the Project Context master-detail screen
   (T11, `docs/plans/project-context-authoring.md`). Purely presentational:
   the flat, repo-wide, alphabetically-sorted document list stays visible
   alongside the detail pane, with the selected row visually marked by
   `ContextDocRow` (AC-2). No data fetching, no business rules — `ContextView`
   (the shell) owns loading/error/empty/unavailable states and only mounts
   this component once there is a non-empty list to show. */
import React from "react";
import type { SpecFile } from "@devdigest/shared";
import { ContextDocRow } from "../ContextView/ContextDocRow";
import { s as viewStyles } from "../ContextView/styles";
import { s } from "./styles";

export function DocumentList({
  files,
  selectedPath,
  onSelect,
}: {
  files: SpecFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <div style={s.pane}>
      <div style={viewStyles.list}>
        {files.map((file) => (
          <ContextDocRow
            key={file.path}
            file={file}
            selected={file.path === selectedPath}
            onSelect={() => onSelect(file.path)}
          />
        ))}
      </div>
    </div>
  );
}
