/* diff-viewer — unified-diff viewer with optional inline GitHub comments.
   Public surface: the DiffViewer component, the FileCard component (for
   embedding a single file outside the flat list, e.g. SmartDiffViewer),
   and the DiffCommentApi contract. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { FileCardProps } from "./FileCard";
export type { DiffLineFinding } from "./CodeLine";
export type { DiffCommentApi } from "./comments";
