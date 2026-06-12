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
  Button,
  Card,
  Select,
  Skeleton,
  Space,
  Spin,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import { CopyOutlined, RobotOutlined, UserOutlined } from "@ant-design/icons";
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
        <div className="flex flex-col overflow-hidden h-screen border-0 rounded-none bg-app-bg shadow-none px-8 py-7 box-border">
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
  const { loading: messagesLoading, run: loadMessages } = useRequest(
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

  // ── copy answer to clipboard ────────────────────────────────────
  const handleCopyAnswer = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(
      () => message.success("已复制到剪贴板"),
      () => message.error("复制失败"),
    );
  }, []);

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
    <div className="flex flex-col overflow-hidden h-screen border-0 rounded-none bg-app-bg shadow-none px-8 py-7 box-border">
      <div
        className="flex flex-col overflow-hidden border border-app-border rounded-app bg-white shadow-app"
        style={{ flex: 1 }}
      >
        {/* Top bar */}
        <div className="flex items-center gap-3 border-b border-app-border-soft bg-white px-6 py-[17px]">
          <div className="flex min-w-0 flex-1 flex-col leading-[1.35]">
            <Text ellipsis className="text-[15px] font-bold text-app-text">
              {activeSessionTitle}
            </Text>
            <span className="text-app-muted text-xs">
              基于企业内部知识库的检索增强问答
            </span>
          </div>
          <Tag className="inline-flex items-center gap-1.5 m-0 border-0 rounded-full bg-[#f4f4f5] text-app-text text-xs font-bold">
            <RobotOutlined />
            知识库已就绪
          </Tag>
        </div>

        {/* Messages area */}
        <div
          ref={messagesContainerRef}
          className="flex-1 overflow-auto bg-white px-6 py-[34px] pb-7 cursor-default"
        >
          {messagesLoading ? (
            <div
              className="w-full max-w-[680px] mx-auto cursor-default"
              style={{ padding: "24px 32px" }}
            >
              <Space direction="vertical" size={20} style={{ width: "100%" }}>
                {[1, 2, 3].map((i) => (
                  <div key={i}>
                    <Skeleton
                      active
                      avatar={{ shape: "circle", size: 36 }}
                      paragraph={{ rows: 1, width: "60%" }}
                      title={false}
                    />
                    <Skeleton
                      active
                      avatar={{ shape: "circle", size: 36 }}
                      paragraph={{ rows: 2 }}
                      title={false}
                      style={{ marginTop: 12 }}
                    />
                  </div>
                ))}
              </Space>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 text-center">
              <div className="flex items-center justify-center w-14 h-14 rounded-app bg-app-primary text-white shadow-[0_10px_22px_rgb(23_23_23_/_0.12)]">
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
            <div className="w-full max-w-[784px] mx-auto px-10 sm:px-12 cursor-default">
              <Space direction="vertical" size={28} style={{ width: "100%" }}>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      animation: "fadeInUp 0.35s ease-out",
                    }}
                  >
                    {/* User question bubble */}
                    <div className="relative flex justify-end">
                      <div className="group w-fit max-w-[75%]">
                        <Card
                          size="small"
                          className="shadow-none !border-app-primary !bg-app-primary [&_.ant-typography]:!text-white"
                          styles={{
                            body: { padding: "14px 18px" },
                          }}
                          style={{
                            borderRadius: `${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadius}px ${token.borderRadiusLG}px`,
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
                            onClick={() => handleCopyAnswer(msg.question)}
                            style={{
                              color: token.colorTextTertiary,
                            }}
                          />
                        </div>
                      </div>
                      <div className="absolute -right-[42px] top-0 flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-app-primary text-white">
                        <UserOutlined style={{ color: "#fff", fontSize: 14 }} />
                      </div>
                    </div>

                    {/* AI answer card */}
                    <div className="relative mt-3">
                      <div className="absolute -left-[42px] top-0 flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-app-primary-soft text-app-primary">
                        <RobotOutlined
                          style={{
                            color: token.colorPrimary,
                            fontSize: 14,
                          }}
                        />
                      </div>
                      <div className="group min-w-0">
                        <Card
                          size="small"
                          className="w-full shadow-none !border-app-border !bg-white"
                          styles={{
                            body: { padding: "14px 18px" },
                          }}
                          style={{
                            borderRadius: `${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadius}px`,
                          }}
                        >
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
                        </Card>
                        <div className="flex justify-end mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ease-out">
                          <Button
                            type="text"
                            size="small"
                            icon={<CopyOutlined />}
                            onClick={() => handleCopyAnswer(msg.answer)}
                            style={{
                              color: token.colorTextTertiary,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </Space>
            </div>
          )}
        </div>

        {/* Input area — sticky bottom */}
        <div className="border-t border-app-border-soft bg-white px-6 py-[14px] pb-4">
          <div className="w-full max-w-[768px] mx-auto">
            {/* LLM selector */}
            <div className="flex items-center gap-2 mb-2 text-app-muted cursor-default">
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
