"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import { RobotOutlined, UserOutlined } from "@ant-design/icons";
import { Sender } from "@ant-design/x";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { throttle } from "@/lib/utils";
import { apiFetch, apiFetchStream } from "@/lib/api";
import CitationList from "@/components/CitationList";

const { Text, Paragraph } = Typography;

// ── types ────────────────────────────────────────────────────────────

interface LLMConfigBrief {
  id: number;
  name: string;
  provider: string;
  model_name: string;
  is_active: boolean;
}

interface Citation {
  document_id: number;
  chunk_id: number;
  locator: string;
  quoted_text_preview?: string | null;
}

interface AskResponse {
  session_id: number;
  message_id: number;
  status: string;
  answer: string;
  citations: Citation[];
}

interface ChatMessageOut {
  id: number;
  question: string;
  answer: string;
  result_status: string;
  created_at: string;
}

interface SessionItem {
  id: number;
  title: string | null;
  created_at: string;
  message_count: number;
}

interface SessionDetail extends SessionItem {
  messages: ChatMessageOut[];
}

// ── component ────────────────────────────────────────────────────────

export default function QAPage() {
  return (
    <Suspense
      fallback={
        <div className="qa-shell">
          <div className="flex h-full min-h-[420px] items-center justify-center">
            <Spin size="large" />
          </div>
        </div>
      }
    >
      <QAPageContent />
    </Suspense>
  );
}

function QAPageContent() {
  const { token } = theme.useToken();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedLlmId, setSelectedLlmId] = useState<number | undefined>(
    undefined,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // ── load session list ──
  const { data: sessions = [], run: loadSessions } =
    useApi<SessionItem[]>("/qa/sessions");

  // ── load LLM configs ──
  const { data: llmConfigs = [] } = useApi<LLMConfigBrief[]>(
    "/llm-configs/brief",
    {
      onSuccess: (configs) => {
        const active = configs.find((c) => c.is_active);
        if (active) setSelectedLlmId(active.id);
      },
    },
  );

  // ── load messages of a session ──
  const { run: loadMessages } = useRequest(
    async (sessionId: number) => {
      const data = await apiFetch<SessionDetail>(`/qa/sessions/${sessionId}`);
      setMessages(data.messages ?? []);
    },
    {
      manual: true,
      onError: () => {
        message.error("加载会话记录失败");
      },
    },
  );

  useEffect(() => {
    const rawSessionId = searchParams.get("session_id");
    if (!rawSessionId) {
      setActiveId(null);
      setMessages([]);
      return;
    }

    const nextSessionId = Number(rawSessionId);
    if (!Number.isFinite(nextSessionId)) {
      setActiveId(null);
      setMessages([]);
      return;
    }

    setActiveId(nextSessionId);
    loadMessages(nextSessionId);
  }, [searchParams, loadMessages]);

  // ── ask question (streaming) ────────────────────────────────────

  const handleAsk = async (msg?: string) => {
    const q = (msg ?? question).trim();
    if (!q) return;
    if (selectedLlmId === undefined) {
      message.warning("请先选择大模型");
      return;
    }
    setQuestion("");
    setLoading(true);

    // Placeholder message that will be updated as tokens arrive
    const placeholder: ChatMessageOut = {
      id: -Date.now(), // temporary negative id; replaced on done
      question: q,
      answer: "",
      result_status: "streaming",
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, placeholder]);
    const placeholderId = placeholder.id;

    try {
      let sessionId = activeId;

      for await (const event of apiFetchStream("/qa/ask/stream", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          session_id: activeId,
          llm_config_id: selectedLlmId ?? null,
        }),
      })) {
        switch (event.type) {
          case "chunk":
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? { ...m, answer: m.answer + event.text }
                  : m,
              ),
            );
            break;

          case "citation":
            // Citations are accumulated internally by the backend;
            // the frontend optionally stores them when the message is reloaded.
            break;

          case "done": {
            // Replace placeholder with finalised message
            if (event.session_id != null) sessionId = event.session_id;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? {
                      ...m,
                      id: event.message_id ?? placeholderId,
                      result_status: event.status,
                    }
                  : m,
              ),
            );

            // If this is a brand-new session, set it active
            if (!activeId && sessionId != null) {
              setActiveId(sessionId);
              router.replace(`/qa?session_id=${sessionId}`);
              await loadSessions();
              window.dispatchEvent(new Event("qa:sessions-updated"));
            }
            break;
          }

          case "error":
            message.error(event.message);
            // Remove the placeholder on error
            setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
            break;
        }
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "获取答案失败");
      // Remove the placeholder on error
      setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
    } finally {
      setLoading(false);
    }
  };

  // ── auto-scroll to bottom (throttled) ──────────────────────────

  const scrollToBottom = useMemo(
    () =>
      throttle(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100),
    [],
  );

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── derived state ────────────────────────────────────────────────

  const sessionMap = useMemo(
    () => new Map(sessions.map((s): [number, SessionItem] => [s.id, s])),
    [sessions],
  );

  const activeSessionTitle = activeId
    ? sessionMap.get(activeId)?.title || "新会话"
    : "向知识库提问";

  // ── render ───────────────────────────────────────────────────────

  return (
    <div className="qa-shell">
      <div className="qa-main" style={{ flex: 1 }}>
        {/* Top bar */}
        <div className="qa-chat-header">
          <div className="qa-chat-title">
            <Text ellipsis className="qa-chat-title-main">
              {activeSessionTitle}
            </Text>
            <span className="qa-chat-title-sub">
              基于企业内部知识库的检索增强问答
            </span>
          </div>
          <Tag className="qa-ready-tag">
            <RobotOutlined />
            知识库已就绪
          </Tag>
        </div>

        {/* Messages area */}
        <div ref={messagesContainerRef} className="qa-messages">
          {messages.length === 0 ? (
            <div className="qa-empty">
              <div className="qa-empty-icon">
                <RobotOutlined
                  style={{
                    fontSize: 28,
                  }}
                />
              </div>
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: token.colorText,
                }}
              >
                {activeId ? "开始你的提问" : "向知识库提问"}
              </Text>
              <Text
                type="secondary"
                style={{ fontSize: 14, textAlign: "center", maxWidth: 400 }}
              >
                基于企业知识库的智能问答助手，准确、高效地回答你的问题
              </Text>
            </div>
          ) : (
            <div className="qa-message-stack">
              <Space direction="vertical" size={20} style={{ width: "100%" }}>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      animation: "fadeInUp 0.35s ease-out",
                    }}
                  >
                    {/* User question bubble */}
                    <Card
                      size="small"
                      className="qa-message-card qa-message-card-user"
                      styles={{
                        body: { padding: "14px 18px" },
                      }}
                      style={{
                        borderRadius: `${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadius}px ${token.borderRadiusLG}px`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                        }}
                      >
                        <div className="qa-avatar qa-avatar-user">
                          <UserOutlined
                            style={{ color: "#fff", fontSize: 14 }}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            strong
                            style={{
                              color: token.colorPrimary,
                              fontSize: 12,
                              marginBottom: 6,
                              display: "block",
                            }}
                          >
                            你
                          </Text>
                          <Paragraph
                            style={{
                              marginBottom: 0,
                              whiteSpace: "pre-wrap",
                              color: token.colorText,
                              lineHeight: 1.7,
                            }}
                          >
                            {msg.question}
                          </Paragraph>
                        </div>
                      </div>
                    </Card>

                    {/* AI answer card */}
                    <Card
                      size="small"
                      className="qa-message-card qa-message-card-assistant"
                      styles={{
                        body: { padding: "14px 18px" },
                      }}
                      style={{
                        marginTop: 12,
                        borderRadius: `${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadius}px`,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                        }}
                      >
                        <div className="qa-avatar qa-avatar-assistant">
                          <RobotOutlined
                            style={{ color: token.colorPrimary, fontSize: 14 }}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              marginBottom: 6,
                            }}
                          >
                            <Text
                              strong
                              style={{
                                color: token.colorPrimary,
                                fontSize: 12,
                              }}
                            >
                              AI 助手
                            </Text>
                            <Tag
                              color={
                                msg.result_status === "answered"
                                  ? "success"
                                  : msg.result_status === "streaming"
                                    ? "processing"
                                    : "warning"
                              }
                              style={{
                                fontSize: 11,
                                lineHeight: "18px",
                                borderRadius: token.borderRadiusSM,
                              }}
                            >
                              {msg.result_status === "answered"
                                ? "已作答"
                                : msg.result_status === "streaming"
                                  ? "生成中…"
                                  : "证据不足"}
                            </Tag>
                          </div>
                          <Paragraph
                            style={{
                              marginBottom: 0,
                              whiteSpace: "pre-wrap",
                              color: token.colorText,
                              lineHeight: 1.75,
                            }}
                          >
                            {msg.answer}
                          </Paragraph>
                        </div>
                      </div>
                    </Card>
                  </div>
                ))}
                <div ref={bottomRef} />
              </Space>
            </div>
          )}
        </div>

        {/* Input area — sticky bottom */}
        <div className="qa-input-bar">
          <div className="qa-input-inner">
            {/* LLM selector */}
            <div className="qa-model-row">
              <RobotOutlined style={{ color: token.colorTextQuaternary }} />
              <Select
                size="small"
                style={{ width: 200 }}
                value={selectedLlmId}
                onChange={setSelectedLlmId}
                placeholder="选择大模型"
                options={[
                  ...(llmConfigs.length > 0
                    ? llmConfigs.map((c) => ({
                        label: `${c.name} (${c.model_name})`,
                        value: c.id,
                      }))
                    : []),
                ]}
                notFoundContent="暂无可用模型"
              />
            </div>

            {/* Input + send row */}
            <Sender
              value={question}
              onChange={setQuestion}
              onSubmit={handleAsk}
              loading={loading}
              onCancel={() => setLoading(false)}
              placeholder="向知识库提问，例如：报销标准是多少？"
              autoSize={{ minRows: 1, maxRows: 5 }}
              className="qa-compose"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
