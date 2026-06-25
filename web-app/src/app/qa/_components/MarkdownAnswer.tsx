import { memo } from "react";
import { XMarkdown } from "@ant-design/x-markdown";
import type { XMarkdownProps } from "@ant-design/x-markdown";

const MARKDOWN_CONFIG: XMarkdownProps["config"] = {
  gfm: true,
  breaks: true,
};

const MARKDOWN_STREAMING: XMarkdownProps["streaming"] = {
  hasNextChunk: true,
  enableAnimation: true,
  tail: true,
};

const MARKDOWN_DONE: XMarkdownProps["streaming"] = {
  hasNextChunk: false,
};

const MarkdownAnswer = memo(function MarkdownAnswer({
  content,
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <XMarkdown
      className="qa-answer-markdown"
      content={content}
      config={MARKDOWN_CONFIG}
      streaming={streaming ? MARKDOWN_STREAMING : MARKDOWN_DONE}
      openLinksInNewTab
      escapeRawHtml
      disableDefaultStyles
    />
  );
});

export default MarkdownAnswer;
