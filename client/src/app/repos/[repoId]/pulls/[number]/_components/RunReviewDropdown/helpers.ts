import { MAX_MODEL_HINT_LENGTH } from "./constants";

/** Remove provider/organisation prefixes and cap unusually long model ids so
    the trailing hint cannot push an agent name outside the dropdown. */
export function compactModelName(model: string): string {
  const modelName = model.split("/").filter(Boolean).at(-1) ?? model;
  if (modelName.length <= MAX_MODEL_HINT_LENGTH) return modelName;
  return `${modelName.slice(0, MAX_MODEL_HINT_LENGTH - 1)}…`;
}
