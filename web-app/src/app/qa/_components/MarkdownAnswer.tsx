import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

const MarkdownAnswer = memo(function MarkdownAnswer({
  content,
}: {
  content: string;
}) {
  return (
    <div className="qa-answer-markdown">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownAnswer;
