import { memo } from "react";
import { Button, Card, Typography } from "antd";
import {
  CopyOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ChatMessageOut, SourceSummary } from "../_types";
import MarkdownAnswer from "./MarkdownAnswer";
import SourceChips from "./SourceChips";

const { Paragraph } = Typography;

const MESSAGE_CARD_STYLES = {
  body: { padding: "14px 18px" },
};

interface ChatMessageItemProps {
  message: ChatMessageOut;
  primaryColor: string;
  tertiaryTextColor: string;
  questionBorderRadius: string;
  answerBorderRadius: string;
  onCopyAnswer: (text: string) => void;
  onSelectSource: (source: SourceSummary) => void;
}

const ChatMessageItem = memo(function ChatMessageItem({
  message: msg,
  primaryColor,
  tertiaryTextColor,
  questionBorderRadius,
  answerBorderRadius,
  onCopyAnswer,
  onSelectSource,
}: ChatMessageItemProps) {
  const hasAnswer = msg.answer.trim().length > 0;

  return (
    <div
      style={{
        animation: "fadeInUp 0.35s ease-out",
      }}
    >
      <div className="relative flex justify-end">
        <div className="group w-fit max-w-[75%]">
          <Card
            size="small"
            className="shadow-none !border-app-primary !bg-app-primary [&_.ant-typography]:!text-white"
            styles={MESSAGE_CARD_STYLES}
            style={{
              borderRadius: questionBorderRadius,
            }}
          >
            <Paragraph
              style={{
                marginBottom: 0,
                whiteSpace: "pre-wrap",
                lineHeight: 1.75,
              }}
            >
              {msg.question}
            </Paragraph>
          </Card>
          <div className="flex justify-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-out">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => onCopyAnswer(msg.question)}
              style={{
                color: tertiaryTextColor,
              }}
            />
          </div>
        </div>
        <div className="absolute -right-[42px] top-0 flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-app-primary text-white">
          <UserOutlined style={{ color: "#fff", fontSize: 14 }} />
        </div>
      </div>

      <div className="relative mt-3">
        <div className="absolute -left-[42px] top-0 flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-app-primary-soft text-app-primary">
          <RobotOutlined
            style={{
              color: primaryColor,
              fontSize: 14,
            }}
          />
        </div>
        {hasAnswer ? (
          <div className="group min-w-0">
            <Card
              size="small"
              className="w-full shadow-none !border-app-border !bg-white"
              styles={MESSAGE_CARD_STYLES}
              style={{
                borderRadius: answerBorderRadius,
              }}
            >
              <MarkdownAnswer content={msg.answer} />
            </Card>
            <div className="mt-1 flex min-h-7 items-start justify-between gap-3">
              <SourceChips
                citations={msg.citations}
                onSelectSource={onSelectSource}
              />
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => onCopyAnswer(msg.answer)}
                className="shrink-0 opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100"
                style={{
                  color: tertiaryTextColor,
                }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-end h-8">正在思考...</div>
        )}
      </div>
    </div>
  );
});

export default ChatMessageItem;
