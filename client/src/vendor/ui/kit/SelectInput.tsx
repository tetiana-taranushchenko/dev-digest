import React from "react";
import { Icon } from "../icons";

/** REAL controlled <select>. */
export function SelectInput({
  value,
  onChange,
  options,
  mono = true,
}: {
  value: string;
  onChange?: (v: string) => void;
  options: (string | { value: string; label: string })[];
  mono?: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 7,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-elevated)",
        position: "relative",
      }}
    >
      <select
        className={mono ? "mono" : undefined}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          display: "block",
          width: "100%",
          minWidth: 0,
          padding: "0 24px 0 0",
          fontSize: 14,
          lineHeight: 1.5,
          color: "var(--text-primary)",
          background: "transparent",
          border: "none",
          outline: "none",
          appearance: "none",
          cursor: "pointer",
        }}
      >
        {options.map((o) => {
          const v = typeof o === "string" ? o : o.value;
          const l = typeof o === "string" ? o : o.label;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
      <Icon.ChevronsUpDown
        size={14}
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          right: 12,
          transform: "translateY(-50%)",
          color: "var(--text-muted)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
