"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  Select,
  Skeleton,
  Space,
  Spin,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import { FilterOutlined, RobotOutlined } from "@ant-design/icons";
import { Sender } from "@ant-design/x";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { throttle } from "@/lib/utils";
import { apiFetch, apiFetchStream } from "@/lib/api";
import ChatMessageItem from "./_components/ChatMessageItem";
import QAScopeDrawer from "./_components/QAScopeDrawer";
import SourceDetailModal from "./_components/SourceDetailModal";
import type {
  CategoryItem,
  ChatMessageOut,
  DocumentItem,
  LLMConfigBrief,
  SessionDetail,
  SessionItem,
  SourceSummary,
} from "./_types";
import {
  EMPTY_DOCUMENTS,
  INSUFFICIENT_EVIDENCE_ANSWER,
} from "./_lib/constants";
import {
  buildCatTree,
  replaceCurrentSessionUrl,
} from "./_lib/category-tree";
import { normalizeMessageAnswer } from "./_lib/message-utils";

const { Text } = Typography;

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
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session_id");

  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedLlmId, setSelectedLlmId] = useState<number | undefined>(
    undefined,
  );
  const [sourceDetail, setSourceDetail] = useState<SourceSummary | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const localSessionUrlSyncRef = useRef<number | null>(null);

  // ── scope selection ──
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scopeCategoryIds, setScopeCategoryIds] = useState<number[]>([]);
  const [scopeDocumentIds, setScopeDocumentIds] = useState<number[]>([]);
  const [activeDrawerCatId, setActiveDrawerCatId] = useState<number | null>(
    null,
  );

  // ── computed scope state ──
  const scopeTotal = scopeCategoryIds.length + scopeDocumentIds.length;
  const scopeLabel = scopeTotal === 0 ? "全部知识库" : `已选 ${scopeTotal} 项`;

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
  const llmOptions = useMemo(
    () =>
      llmConfigs.map((config) => ({
        label: `${config.name} (${config.model_name})`,
        value: config.id,
      })),
    [llmConfigs],
  );

  // ── load categories for scope drawer ──
  const { data: catData } = useApi<{ items: CategoryItem[] }>("/categories");
  const categories = catData?.items ?? [];
  const catTree = useMemo(() => buildCatTree(categories), [categories]);
  const activeDrawerCatName = useMemo(
    () => categories.find((c) => c.id === activeDrawerCatId)?.name ?? "",
    [activeDrawerCatId, categories],
  );
  const scopeCategoryKeys = useMemo(
    () => scopeCategoryIds.map((id) => `cat-${id}`),
    [scopeCategoryIds],
  );

  // ── documents in active drawer category ──
  const { data: scopeDocsData } = useRequest(
    async () => {
      if (activeDrawerCatId == null) return EMPTY_DOCUMENTS;
      return apiFetch<{ items: DocumentItem[] }>(
        `/documents?category_id=${activeDrawerCatId}&limit=100`,
      );
    },
    { refreshDeps: [activeDrawerCatId] },
  );
  const scopeDocs = scopeDocsData?.items ?? [];

  // ── load messages of a session ──
  const { loading: messagesLoading, run: loadMessages } = useRequest(
    async (sessionId: number) => {
      const data = await apiFetch<SessionDetail>(`/qa/sessions/${sessionId}`);
      setMessages((data.messages ?? []).map(normalizeMessageAnswer));
    },
    {
      manual: true,
      onError: () => {
        message.error("加载会话记录失败");
      },
    },
  );

  useEffect(() => {
    const rawSessionId = sessionIdParam;
    if (!rawSessionId) {
      setActiveId(null);
      setMessages([]);
      localSessionUrlSyncRef.current = null;
      return;
    }

    const nextSessionId = Number(rawSessionId);
    if (!Number.isFinite(nextSessionId)) {
      setActiveId(null);
      setMessages([]);
      localSessionUrlSyncRef.current = null;
      return;
    }

    setActiveId(nextSessionId);
    if (localSessionUrlSyncRef.current === nextSessionId) {
      localSessionUrlSyncRef.current = null;
      return;
    }

    loadMessages(nextSessionId);
  }, [sessionIdParam, loadMessages]);

  // ── ask question (streaming) ────────────────────────────────────

  const handleAsk = useCallback(
    async (msg?: string) => {
      const q = (msg ?? question).trim();
      if (!q) return;
      if (selectedLlmId === undefined) {
        message.warning("请先选择大模型");
        return;
      }
      setQuestion("");
      setLoading(true);

      // Placeholder message that will be updated as tokens arrive.
      const placeholder: ChatMessageOut = {
        id: -Date.now(),
        question: q,
        answer: "",
        result_status: "streaming",
        created_at: new Date().toISOString(),
        citations: [],
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
            category_ids: scopeCategoryIds.length > 0 ? scopeCategoryIds : null,
            document_ids: scopeDocumentIds.length > 0 ? scopeDocumentIds : null,
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
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === placeholderId
                    ? {
                        ...m,
                        citations: [...(m.citations ?? []), event],
                      }
                    : m,
                ),
              );
              break;

            case "done": {
              if (event.session_id != null) sessionId = event.session_id;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === placeholderId
                    ? {
                        ...m,
                        id: event.message_id ?? placeholderId,
                        answer:
                          m.answer ||
                          (event.status === "insufficient_evidence"
                            ? INSUFFICIENT_EVIDENCE_ANSWER
                            : ""),
                        result_status: event.status,
                      }
                    : m,
                ),
              );

              if (!activeId && sessionId != null) {
                localSessionUrlSyncRef.current = sessionId;
                setActiveId(sessionId);
                replaceCurrentSessionUrl(sessionId);
                await loadSessions();
                window.dispatchEvent(new Event("qa:sessions-updated"));
              }
              break;
            }

            case "error":
              message.error(event.message);
              setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
              break;
          }
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : "获取答案失败");
        setMessages((prev) => prev.filter((m) => m.id !== placeholderId));
      } finally {
        setLoading(false);
      }
    },
    [
      activeId,
      loadSessions,
      question,
      scopeCategoryIds,
      scopeDocumentIds,
      selectedLlmId,
    ],
  );

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

  useEffect(() => () => scrollToBottom.cancel(), [scrollToBottom]);

  // ── copy answer to clipboard ────────────────────────────────────
  const handleCopyAnswer = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(
      () => message.success("已复制到剪贴板"),
      () => message.error("复制失败"),
    );
  }, []);
  const handleSelectSource = useCallback((source: SourceSummary) => {
    setSourceDetail(source);
  }, []);
  const handleCloseSourceDetail = useCallback(() => {
    setSourceDetail(null);
  }, []);
  const handleOpenScopeDrawer = useCallback(() => {
    setDrawerOpen(true);
  }, []);
  const handleCloseScopeDrawer = useCallback(() => {
    setDrawerOpen(false);
  }, []);
  const handleClearScope = useCallback(() => {
    setScopeCategoryIds([]);
    setScopeDocumentIds([]);
  }, []);

  // ── derived state ────────────────────────────────────────────────

  const sessionMap = useMemo(
    () => new Map(sessions.map((s): [number, SessionItem] => [s.id, s])),
    [sessions],
  );

  const activeSessionTitle = activeId
    ? sessionMap.get(activeId)?.title || "新会话"
    : "向知识库提问";
  const questionBorderRadius = `${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadius}px ${token.borderRadiusLG}px`;
  const answerBorderRadius = `${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadiusLG}px ${token.borderRadius}px`;

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
          <Tag
            className="inline-flex items-center gap-1.5 m-0 border-0 rounded-full bg-[#f4f4f5] text-app-text text-xs font-bold cursor-pointer hover:bg-[#e4e4e7] transition-colors select-none"
            onClick={handleOpenScopeDrawer}
          >
            <FilterOutlined />
            {scopeLabel}
          </Tag>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-auto bg-white px-6 py-[34px] pb-7 cursor-default">
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
                  <ChatMessageItem
                    key={msg.id}
                    message={msg}
                    primaryColor={token.colorPrimary}
                    tertiaryTextColor={token.colorTextTertiary}
                    questionBorderRadius={questionBorderRadius}
                    answerBorderRadius={answerBorderRadius}
                    onCopyAnswer={handleCopyAnswer}
                    onSelectSource={handleSelectSource}
                  />
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
                options={llmOptions}
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

      <QAScopeDrawer
        open={drawerOpen}
        onClose={handleCloseScopeDrawer}
        catTree={catTree}
        activeDrawerCatId={activeDrawerCatId}
        activeDrawerCatName={activeDrawerCatName}
        scopeCategoryIds={scopeCategoryIds}
        scopeCategoryKeys={scopeCategoryKeys}
        scopeDocumentIds={scopeDocumentIds}
        scopeDocs={scopeDocs}
        scopeLabel={scopeLabel}
        scopeTotal={scopeTotal}
        onClearScope={handleClearScope}
        onCategoryIdsChange={setScopeCategoryIds}
        onDocumentIdsChange={setScopeDocumentIds}
        onActiveDrawerCatIdChange={setActiveDrawerCatId}
      />

      <SourceDetailModal
        sourceDetail={sourceDetail}
        onClose={handleCloseSourceDetail}
      />
    </div>
  );
}
