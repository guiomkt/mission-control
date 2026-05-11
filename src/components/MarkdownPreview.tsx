"use client";

import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

interface MarkdownPreviewProps {
  content: string;
}

/**
 * Safe markdown renderer.
 *
 * Replaces the prior hand-rolled regex parser that piped into
 * `dangerouslySetInnerHTML` (PRD R4). The previous implementation accepted
 * `[click](javascript:alert(1))` as a valid link, among other things.
 *
 * `react-markdown` + `rehype-sanitize` apply a strict allowlist of tags and
 * attributes, strip `on*=` handlers, and reject `javascript:` / `data:` URLs.
 */

// Lock the schema down to defaults; no `unknown` props slip through.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // Allow target / rel on anchors so external links open in a new tab.
    a: [
      ...(defaultSchema.attributes?.a || []),
      ["target"],
      ["rel"],
    ],
    code: [...(defaultSchema.attributes?.code || []), ["className"]],
  },
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div
      className="h-full overflow-auto p-6"
      style={{ backgroundColor: "var(--card)" }}
    >
      <div
        className="prose prose-invert max-w-none"
        style={{ color: "var(--text-secondary)" }}
      >
        <ReactMarkdown
          rehypePlugins={[[rehypeSanitize, schema]]}
          components={{
            a: ({ node: _node, ...props }) => (
              <a {...props} target="_blank" rel="noopener noreferrer" />
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
