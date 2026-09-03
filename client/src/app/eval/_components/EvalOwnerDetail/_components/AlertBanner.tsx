"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { s } from "../styles";

/**
 * AlertBanner — AC-32's regression-alert banner, rendered only when
 * `EvalDashboard.alert` is non-null (AC-18: the server names the worst
 * metric regressed past a 5pt threshold, `server/src/modules/eval/dashboard.ts`).
 * The component receives the already-non-null string, not the dashboard —
 * the caller owns the null check so this stays a pure "show what I'm given"
 * leaf (react-best-practices: business logic outside the component body).
 */
export function AlertBanner({ alert }: { alert: string }) {
  return (
    <div role="alert" style={s.alertBanner}>
      <Icon.AlertTriangle size={16} style={{ color: "var(--warn)" }} />
      <span style={s.alertText}>{alert}</span>
    </div>
  );
}
