"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

/** Skill sources that are untrusted until vetted — mirrors the server-side gate. */
const UNTRUSTED_SOURCES = ["imported_url", "community"] as const;

/** Preview tab — renders the skill body as the reviewing agent receives it.
 *  For untrusted sources, also shows the delimiter framing the body is
 *  actually wrapped in when it reaches the LLM (see reviewer-core's
 *  wrapUntrusted, applied in run-executor.ts before prompt assembly). */
export function PreviewTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const isUntrusted = (UNTRUSTED_SOURCES as readonly string[]).includes(skill.source);

  return (
    <div style={s.wrap}>
      <div style={s.caption}>{t("preview.caption")}</div>
      {isUntrusted ? (
        <div style={s.untrustedBox}>
          <Badge color="var(--warn)">{t("preview.untrustedBadge")}</Badge>
          <span style={s.wrapperTag}>{`<untrusted source="skill:${skill.id}">`}</span>
          <div style={s.rendered}>
            <Markdown>{skill.body}</Markdown>
          </div>
          <span style={s.wrapperTag}>{"</untrusted>"}</span>
        </div>
      ) : (
        <div style={s.rendered}>
          <Markdown>{skill.body}</Markdown>
        </div>
      )}
    </div>
  );
}
