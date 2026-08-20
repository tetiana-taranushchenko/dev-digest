"use client";

import { useRouter } from "next/navigation";
import { Icon, MonoLink } from "@devdigest/ui";
import type { BlastCaller, PrFile } from "@devdigest/shared";
import { resolveCallerDestination } from "../helpers";
import { s } from "../styles";

/** One `file:line` caller row — routes in-app when the file is part of the
 *  PR's diff AND its patch actually covers the caller's line, otherwise
 *  opens the GitHub blob in a new tab (REQ-7). */
export function CallerRow({
  caller,
  files,
  repoId,
  prNumber,
  repoFullName,
  headSha,
}: {
  caller: BlastCaller;
  files: PrFile[];
  repoId: string;
  prNumber: number;
  repoFullName?: string | null;
  headSha?: string | null;
}) {
  const router = useRouter();
  const destination = resolveCallerDestination({
    caller,
    files,
    repoId,
    prNumber,
    repoFullName,
    headSha,
  });

  const label = `${caller.file}:${caller.line}`;

  if (destination.kind === "in-app") {
    return (
      <div style={s.callerRow}>
        <Icon.CornerDownRight size={12} style={s.callerIcon} />
        <MonoLink onClick={() => router.push(destination.route)}>{label}</MonoLink>
      </div>
    );
  }

  if (destination.url) {
    return (
      <div style={s.callerRow}>
        <Icon.CornerDownRight size={12} style={s.callerIcon} />
        <MonoLink href={destination.url}>{label}</MonoLink>
      </div>
    );
  }

  return (
    <div className="mono" style={s.callerRow}>
      <Icon.CornerDownRight size={12} style={s.callerIcon} />
      {label}
    </div>
  );
}
