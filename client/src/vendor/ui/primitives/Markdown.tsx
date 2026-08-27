import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          code: ({ className, children }) => {
            // Fenced code blocks (```lang or a multi-line body) render plain
            // inside `pre`'s own box below — the inline "pill" style is only
            // for a short inline `code` span, never a whole block.
            const isBlock = className?.includes("language-") || String(children).includes("\n");
            if (isBlock) {
              return (
                <code className="mono" style={{ fontSize: "0.85em", color: "var(--text-primary)" }}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="mono"
                style={{
                  fontSize: "0.92em",
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "var(--bg-hover)",
                  color: "var(--accent-text)",
                }}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre
              style={{
                margin: "0 0 12px",
                padding: "14px 16px",
                borderRadius: 8,
                background: "var(--code-bg)",
                border: "1px solid var(--border)",
                overflowX: "auto",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {children}
            </pre>
          ),
          a: ({ children, href }) => (
            <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
