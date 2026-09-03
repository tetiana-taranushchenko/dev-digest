/** The three Input views mapping to `input_diff` / `input_files` /
 *  `input_meta` (AC-24). */
export const INPUT_TAB_KEYS = ["diff", "files", "prMeta"] as const;
export type InputTabKey = (typeof INPUT_TAB_KEYS)[number];

/** Owner kinds selectable from the owner picker shown when a case has no
 *  resolvable owner yet (AC-30). */
export const OWNER_KIND_VALUES = ["agent", "skill"] as const;
