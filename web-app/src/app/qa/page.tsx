"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Input,
  Layout,
  List,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
  theme,
  Grid,
} from "antd";
import {
  DeleteOutlined,
  PlusOutlined,
  SendOutlined,
  MessageOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { apiFetch } from "@/lib/api";
import CitationList from "@/components/CitationList";

const { Sider, Content } = Layout;
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
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [llmConfigs, setLlmConfigs] = useState<LLMConfigBrief[]>([]);
  const [selectedLlmId, setSelectedLlmId] = useState<number | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // ── load session list ────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const data = await apiFetch<SessionItem[]>("/qa/sessions");
      setSessions(data);
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ── load LLM configs ───────────────────────────────────────────

  useEffect(() => {
    apiFetch<LLMConfigBrief[]>("/llm-configs/brief")
      .then((configs) => {
        setLlmConfigs(configs);
        const active = configs.find((c) => c.is_active);
        if (active) setSelectedLlmId(active.id);
      })
      .catch(() => {});
  }, []);

  // ── load messages of a session ───────────────────────────────────

  const loadMessages = useCallback(async (sessionId: number) => {
    try {
      const data = await apiFetch<SessionDetail>(`/qa/sessions/${sessionId}`);
      setMessages(data.messages ?? []);
    } catch {
      message.error("加载会话记录失败");
    }
  }, []);

  // ── switch session ───────────────────────────────────────────────

  const switchSession = (id: number) => {
    setActiveId(id);
    loadMessages(id);
  };

  // ── new session ──────────────────────────────────────────────────

  const newSession = async () => {
    try {
      const data = await apiFetch<{ id: number; title: string | null }>(
        "/qa/sessions",
        { method: "POST", body: JSON.stringify({}) },
      );
      await loadSessions();
      setActiveId(data.id);
      setMessages([]);
      setQuestion("");
    } catch {
      message.error("创建会话失败");
    }
  };

  // ── delete session ───────────────────────────────────────────────

  const deleteSession = async (id: number) => {
    try {
      await apiFetch(`/qa/sessions/${id}`, { method: "DELETE" });
      message.success("已删除会话");
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
      await loadSessions();
    } catch {
      message.error("删除失败");
    }
  };

  // ── ask question ─────────────────────────────────────────────────

  const handleAsk = async () => {
    const q = question.trim();
    if (!q) return;
    setQuestion("");
    setLoading(true);

    try {
      const data = await apiFetch<AskResponse>("/qa/ask", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          session_id: activeId,
          llm_config_id: selectedLlmId ?? null,
        }),
      });

      const newMsg: ChatMessageOut = {
        id: data.message_id,
        question: q,
        answer: data.answer,
        result_status: data.status,
        created_at: new Date().toISOString(),
      };

      // If this is a brand-new session, set it active
      if (!activeId) {
        setActiveId(data.session_id);
        await loadSessions();
      }

      setMessages((prev) => [...prev, newMsg]);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "获取答案失败");
    } finally {
      setLoading(false);
    }
  };

  // ── auto-scroll to bottom ────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── derived state ────────────────────────────────────────────────

  const siderWidth = sidebarCollapsed ? 0 : isMobile ? 260 : 280;

  // ── render ───────────────────────────────────────────────────────

  return (
    <Layout
      style={{
        background: "transparent",
        minHeight: "calc(100vh - 112px)",
        position: "relative",
      }}
    >
      {/* ── Mobile overlay ──────────────────────────────────────── */}
      {isMobile && !sidebarCollapsed && (
        <div
          onClick={() => setSidebarCollapsed(true)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            zIndex: 99,
          }}
        />
      )}

      {/* ── Sidebar: session list ────────────────────────────────── */}
      <Sider
        width={siderWidth}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          overflow: "auto",
          height: "calc(100vh - 112px)",
          position: isMobile ? "fixed" : "sticky",
          top: isMobile ? 0 : undefined,
          left: 0,
          zIndex: isMobile ? 100 : 1,
          transition: "width 0.25s ease",
        }}
      >
        {/* Sidebar header */}
        <div
          style={{
            padding: "20px 16px 16px",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={() => {
              newSession();
              if (isMobile) setSidebarCollapsed(true);
            }}
            size="large"
            style={{
              height: 44,
              borderRadius: token.borderRadiusLG,
              fontWeight: 500,
              boxShadow: "0 2px 6px rgba(79,70,229,0.25)",
            }}
          >
            新建会话
          </Button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {sessionsLoading ? (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: 48,
              }}
            >
              <Spin size="default" />
            </div>
          ) : sessions.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span style={{ color: token.colorTextSecondary }}>
                  暂无历史会话
                </span>
              }
              style={{ marginTop: 48 }}
            />
          ) : (
            <List
              dataSource={sessions}
              split={false}
              renderItem={(item) => {
                const isActive = activeId === item.id;
                return (
                  <div style={{ padding: "0 8px", marginBottom: 2 }}>
                    <div
                      onClick={() => {
                        switchSession(item.id);
                        if (isMobile) setSidebarCollapsed(true);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: token.borderRadius,
                        cursor: "pointer",
                        background: isActive
                          ? token.colorPrimaryBg
                          : "transparent",
                        borderLeft: isActive
                          ? `3px solid ${token.colorPrimary}`
                          : "3px solid transparent",
                        transition: "all 0.2s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive)
                          (e.currentTarget as HTMLElement).style.background =
                            token.colorBgTextHover;
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive)
                          (e.currentTarget as HTMLElement).style.background =
                            "transparent";
                      }}
                    >
                      <MessageOutlined
                        style={{
                          fontSize: 16,
                          color: isActive
                            ? token.colorPrimary
                            : token.colorTextQuaternary,
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          ellipsis
                          style={{
                            fontWeight: isActive ? 600 : 400,
                            color: isActive
                              ? token.colorPrimary
                              : token.colorText,
                            fontSize: 14,
                          }}
                        >
                          {item.title || "新会话"}
                        </Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {item.message_count} 条问答
                          </Text>
                        </div>
                      </div>
                      <Popconfirm
                        title="确定删除此会话？"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          deleteSession(item.id);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                        placement="right"
                      >
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={(e) => e.stopPropagation()}
                          style={{ opacity: 0.5 }}
                        />
                      </Popconfirm>
                    </div>
                  </div>
                );
              }}
            />
          )}
        </div>
      </Sider>

      {/* ── Main: Q&A area ──────────────────────────────────────── */}
      <Content
        style={{
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 112px)",
          position: "relative",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "12px 20px",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            gap: 12,
          }}
        >
          <Button
            type="text"
            icon={
              sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />
            }
            onClick={() => setSidebarCollapsed((v) => !v)}
          />
          <Text
            strong
            ellipsis
            style={{ fontSize: 16, color: token.colorText }}
          >
            {activeId
              ? sessions.find((s) => s.id === activeId)?.title || "新会话"
              : "智能问答"}
          </Text>
          {activeId && (
            <Tag color="blue" style={{ marginLeft: "auto" }}>
              {messages.length} 轮对话
            </Tag>
          )}
        </div>

        {/* Messages area */}
        <div
          ref={messagesContainerRef}
          style={{
            flex: 1,
            overflow: "auto",
            padding: "20px 24px",
            background: token.colorBgLayout,
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                gap: 16,
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  background: token.colorPrimaryBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <RobotOutlined
                  style={{
                    fontSize: 36,
                    color: token.colorPrimary,
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
                {activeId ? "开始你的提问" : "选择一个会话开始问答"}
              </Text>
              <Text
                type="secondary"
                style={{ fontSize: 14, textAlign: "center", maxWidth: 400 }}
              >
                基于企业知识库的智能问答助手，准确、高效地回答你的问题
              </Text>
            </div>
          ) : (
            <div style={{ maxWidth: 800, margin: "0 auto" }}>
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
                      styles={{
                        body: { padding: "14px 18px" },
                      }}
                      style={{
                        borderRadius: `${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadius}px ${token.borderRadiusLG}px`,
                        borderColor: token.colorPrimaryBorder,
                        background: `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorPrimaryBgHover} 100%)`,
                        maxWidth: "85%",
                        marginLeft: "auto",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: token.colorPrimary,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
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
                      styles={{
                        body: { padding: "14px 18px" },
                      }}
                      style={{
                        marginTop: 12,
                        borderRadius: `${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadius}px`,
                        borderColor: token.colorSuccessBorder,
                        background: `linear-gradient(135deg, ${token.colorSuccessBg} 0%, ${token.colorSuccessBgHover} 100%)`,
                        maxWidth: "85%",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: token.colorSuccess,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <RobotOutlined
                            style={{ color: "#fff", fontSize: 14 }}
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
                                color: token.colorSuccess,
                                fontSize: 12,
                              }}
                            >
                              AI 助手
                            </Text>
                            <Tag
                              color={
                                msg.result_status === "answered"
                                  ? "success"
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
        <div
          style={{
            padding: "16px 24px",
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            boxShadow: "0 -2px 8px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ maxWidth: 800, margin: "0 auto" }}>
            {/* LLM selector */}
            <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <RobotOutlined style={{ color: token.colorTextQuaternary }} />
              <Select
                size="small"
                style={{ minWidth: 200 }}
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
            <Space.Compact style={{ width: "100%" }}>
              <Input
                size="large"
                placeholder="请输入您的问题，按 Enter 发送..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onPressEnter={handleAsk}
                disabled={loading}
                prefix={
                  <MessageOutlined
                    style={{ color: token.colorTextQuaternary }}
                  />
                }
                style={{
                  borderRadius: `${token.borderRadiusLG}px 0 0 ${token.borderRadiusLG}px`,
                }}
              />
              <Button
                type="primary"
                size="large"
                icon={<SendOutlined />}
                loading={loading}
                onClick={handleAsk}
                disabled={!question.trim()}
                style={{
                  borderRadius: `0 ${token.borderRadiusLG}px ${token.borderRadiusLG}px 0`,
                  minWidth: 80,
                }}
              >
                {!loading && "发送"}
              </Button>
            </Space.Compact>
          </div>
        </div>
      </Content>
    </Layout>
  );
}
