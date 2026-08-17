import type { SmartDiffRole } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Role -> localized group title and explanatory subtitle. */
export const ROLE_TITLE_KEY: Record<SmartDiffRole, string> = {
  core: "groups.core.title",
  wiring: "groups.wiring.title",
  boilerplate: "groups.boilerplate.title",
};

export const ROLE_DESCRIPTION_KEY: Record<SmartDiffRole, string> = {
  core: "groups.core.description",
  wiring: "groups.wiring.description",
  boilerplate: "groups.boilerplate.description",
};

/** Role -> icon shown next to the group heading. */
export const ROLE_ICON: Record<SmartDiffRole, IconName> = {
  core: "Code",
  wiring: "Workflow",
  boilerplate: "Boxes",
};
