import { memo } from "react";
import { Card, Typography } from "antd";
import {
  BranchesOutlined,
  EditOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Actions, Bubble } from "@ant-design/x";
import type { ChatMessageOut, SourceSummary } from "../_types";
import {
  canForkChatMessage,
  shouldRenderAssistantAnswer,
} from "../_lib/message-utils";
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
  lastIndex?: boolean;
  forking?: boolean;
  onEditQuestion: (message: ChatMessageOut) => void;
  onForkAnswer: (message: ChatMessageOut) => void;
  onSelectSource: (source: SourceSummary) => void;
}

const ChatMessageItem = memo(function ChatMessageItem({
  message: msg,
  primaryColor,
  tertiaryTextColor,
  questionBorderRadius,
  answerBorderRadius,
  lastIndex,
  forking,
  onEditQuestion,
  onForkAnswer,
  onSelectSource,
}: ChatMessageItemProps) {
  const hasAnswer = msg.answer.trim().length > 0;
  const renderAssistantAnswer = shouldRenderAssistantAnswer(msg);
  const canFork = canForkChatMessage(msg);
  const actionStyles = {
    item: { color: tertiaryTextColor },
  };

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
            <Actions
              variant="borderless"
              styles={actionStyles}
              items={[
                {
                  key: "copy",
                  actionRender: () => (
                    <Actions.Copy
                      text={msg.question}
                      style={{ color: tertiaryTextColor }}
                    />
                  ),
                },
                ...(lastIndex
                  ? [
                      {
                        key: "edit",
                        icon: <EditOutlined />,
                        label: "编辑",
                        onItemClick: () => onEditQuestion(msg),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </div>
        <div className="absolute -right-[42px] top-0 flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-app-primary text-white">
          <UserOutlined style={{ color: "#fff", fontSize: 14 }} />
        </div>
      </div>

      {renderAssistantAnswer ? (
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
                <Actions
                  variant="borderless"
                  className="shrink-0 opacity-0 transition-opacity duration-500 ease-out group-hover:opacity-100"
                  styles={actionStyles}
                  items={[
                    {
                      key: "copy",
                      actionRender: () => (
                        <Actions.Copy
                          text={msg.answer}
                          style={{ color: tertiaryTextColor }}
                        />
                      ),
                    },
                    ...(canFork
                      ? [
                          {
                            key: "fork",
                            icon: <BranchesOutlined />,
                            label: "分叉",
                            onItemClick: () => {
                              if (!forking) onForkAnswer(msg);
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            </div>
          ) : (
            <Bubble loading content={null} />
          )}
        </div>
      ) : null}
    </div>
  );
});

export default ChatMessageItem;
