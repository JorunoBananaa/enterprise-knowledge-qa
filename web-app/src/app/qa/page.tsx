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
  Select,
  Skeleton,
  Space,
  Spin,
  Tag,
  Typography,
  message,
  theme,
} from "antd";
import { isNull } from "lodash";
import { FilterOutlined, RobotOutlined } from "@ant-design/icons";
import { Sender, SenderProps } from "@ant-design/x";
import { useXChat, type MessageInfo } from "@ant-design/x-sdk";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { throttle } from "@/lib/utils";
import { apiFetch } from "@/lib/api";
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
import { EMPTY_DOCUMENTS } from "./_lib/constants";
import { buildCatTree } from "./_lib/category-tree";
import {
  canForkChatMessage,
  getChatMessageRenderKey,
  normalizeMessageAnswer,
} from "./_lib/message-utils";
import { replaceCurrentSessionUrl } from "./_lib/session-url";
import {
  createPendingQAChatMessage,
  createQAChatProvider,
  type QAAskInput,
} from "./_lib/qa-chat-provider";

const { Text } = Typography;

interface ForkSessionResponse {
  session_id: number;
}

function createRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── component ────────────────────────────────────────────────────────

export default function QAPage() {
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session_id");

  if (isNull(sessionIdParam)) {
    return null;
  }

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
      <QAPageContent sessionIdParam={sessionIdParam} />
    </Suspense>
  );
}

function QAPageContent({ sessionIdParam }: { sessionIdParam: string }) {
  const { token } = theme.useToken();
  const router = useRouter();

  const [activeId, setActiveId] = useState<number | null>(null);
  const [forkingMessageId, setForkingMessageId] = useState<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const [editQuestion, setEditQuestion] = useState("");
  const [question, setQuestion] = useState("");
  const [selectedLlmId, setSelectedLlmId] = useState<number | undefined>(
    undefined,
  );
  const [sourceDetail, setSourceDetail] = useState<SourceSummary | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const localSessionUrlSyncRef = useRef<number | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);

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

  // ── chat provider ──
  const [provider] = useState(createQAChatProvider);
  const requestPlaceholder = useCallback(
    (requestParams: Partial<QAAskInput>) =>
      createPendingQAChatMessage(
        requestParams.question?.trim() || "",
        requestParams.request_id,
      ),
    [],
  );
  const requestFallback = useCallback(
    (
      requestParams: Partial<QAAskInput>,
      {
        error,
        messageInfo,
      }: {
        error: Error;
        messageInfo?: MessageInfo<ChatMessageOut>;
      },
    ) => {
      const base =
        messageInfo?.message ||
        createPendingQAChatMessage(
          requestParams.question?.trim() || "",
          requestParams.request_id,
        );

      if (error.name !== "AbortError") {
        message.error(error.message || "获取答案失败");
      }

      return {
        ...base,
        answer:
          base.answer ||
          (error.name === "AbortError" ? "" : error.message || "获取答案失败"),
        result_status: error.name === "AbortError" ? "aborted" : "error",
      };
    },
    [],
  );
  const {
    messages: chatMessageInfos,
    setMessages: setChatMessageInfos,
    onRequest,
    isRequesting,
    abort,
  } = useXChat<ChatMessageOut, ChatMessageOut, QAAskInput>({
    provider,
    requestPlaceholder,
    requestFallback,
  });
  const normalizedChatMessageInfos = useMemo(
    () =>
      chatMessageInfos.map((info) => ({
        ...info,
        message: normalizeMessageAnswer(info.message),
      })),
    [chatMessageInfos],
  );
  const messages = useMemo(
    () => normalizedChatMessageInfos.map((info) => info.message),
    [normalizedChatMessageInfos],
  );

  // ── load session list ──
  const { data: sessions = [], run: loadSessions } =
    useApi<SessionItem[]>("/qa/sessions");

  // ── fork session ──
  const { runAsync: forkSession } = useApi<
    ForkSessionResponse,
    [number],
    "POST"
  >((messageId: number) => `/qa/messages/${messageId}/fork`, {
    method: "POST",
    manual: true,
  });

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
      setChatMessageInfos(
        (data.messages ?? []).map(
          (chatMessage): MessageInfo<ChatMessageOut> => ({
            id: chatMessage.id,
            message: normalizeMessageAnswer(chatMessage),
            status: "success",
          }),
        ),
      );
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
      setChatMessageInfos([]);
      localSessionUrlSyncRef.current = null;
      return;
    }

    const nextSessionId = Number(rawSessionId);
    if (!Number.isFinite(nextSessionId)) {
      setActiveId(null);
      setChatMessageInfos([]);
      localSessionUrlSyncRef.current = null;
      return;
    }

    setActiveId(nextSessionId);
    if (localSessionUrlSyncRef.current === nextSessionId) {
      localSessionUrlSyncRef.current = null;
      return;
    }

    loadMessages(nextSessionId);
  }, [sessionIdParam, loadMessages, setChatMessageInfos]);

  const streamedSessionId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const sessionId = messages[index].session_id;
      if (sessionId != null) return sessionId;
    }
    return null;
  }, [messages]);

  useEffect(() => {
    if (activeId || streamedSessionId == null) return;
    if (localSessionUrlSyncRef.current === streamedSessionId) return;

    localSessionUrlSyncRef.current = streamedSessionId;
    setActiveId(streamedSessionId);
    replaceCurrentSessionUrl(streamedSessionId);
    Promise.resolve(loadSessions()).finally(() => {
      window.dispatchEvent(new Event("qa:sessions-updated"));
    });
  }, [activeId, loadSessions, streamedSessionId]);

  // ── ask question (streaming) ────────────────────────────────────

  const handleAsk = useCallback(
    (msg?: string, editMessageId?: number | null) => {
      const q = (msg ?? question).trim();
      if (!q) return;
      if (selectedLlmId === undefined) {
        message.warning("请先选择大模型");
        return;
      }
      setQuestion("");

      // 编辑模式：乐观更新前端消息列表（移除编辑消息及后续消息）
      // 注意：editMessageId 必须是有效的数字，过滤掉 Sender onSubmit 误传的 slotConfig 数组
      const effectiveEditId =
        typeof editMessageId === "number" ? editMessageId : editingMessageId;
      if (effectiveEditId != null) {
        setChatMessageInfos((prev) => {
          const editIndex = prev.findIndex(
            (info) => info.message.id === effectiveEditId,
          );
          if (editIndex === -1) return prev;
          return prev.slice(0, editIndex);
        });
        setEditingMessageId(null);
        setEditQuestion("");
      }

      const requestId = createRequestId();
      activeRequestIdRef.current = requestId;

      onRequest({
        question: q,
        session_id: activeId,
        llm_config_id: selectedLlmId ?? null,
        category_ids: scopeCategoryIds.length > 0 ? scopeCategoryIds : null,
        document_ids: scopeDocumentIds.length > 0 ? scopeDocumentIds : null,
        request_id: requestId,
        edit_message_id: effectiveEditId,
      });
    },
    [
      activeId,
      editingMessageId,
      onRequest,
      question,
      scopeCategoryIds,
      scopeDocumentIds,
      selectedLlmId,
      setChatMessageInfos,
    ],
  );

  const handleCancel = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    if (requestId) {
      void apiFetch("/qa/ask/cancel", {
        method: "POST",
        body: JSON.stringify({ request_id: requestId }),
      }).catch(() => {
        /* best-effort cancellation */
      });
    }

    abort();
    activeRequestIdRef.current = null;
  }, [abort]);

  useEffect(() => {
    if (!isRequesting) {
      activeRequestIdRef.current = null;
    }
  }, [isRequesting]);

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

  const handleEditQuestion = useCallback((msg: ChatMessageOut) => {
    setEditingMessageId(msg.id);
    setEditQuestion(msg.question);
  }, []);
  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditQuestion("");
  }, []);
  // 内联编辑发送框提交：将 editQuestion 值和编辑消息 ID 传入 handleAsk
  const handleInlineEditSubmit = useCallback(
    (val?: string) => {
      const q = (typeof val === "string" ? val : editQuestion).trim();
      if (!q) return;
      handleAsk(q, editingMessageId);
    },
    [editQuestion, editingMessageId, handleAsk],
  );
  const handleSubmitQuestion: SenderProps["onSubmit"] = useCallback(
    (msg: string) => {
      handleAsk(msg);
    },
    [handleAsk],
  );
  const handleForkAnswer = useCallback(
    async (msg: ChatMessageOut) => {
      if (!canForkChatMessage(msg) || forkingMessageId !== null) return;

      setForkingMessageId(msg.id);
      try {
        const result = await forkSession(msg.id);
        router.replace(`/qa?session_id=${result.session_id}`);
        await Promise.resolve(loadSessions());
        window.dispatchEvent(new Event("qa:sessions-updated"));
      } catch {
        message.error("创建分支失败");
      } finally {
        setForkingMessageId(null);
      }
    },
    [forkSession, forkingMessageId, loadSessions, router],
  );
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
              基于知识库的检索增强问答
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
                基于知识库的智能问答助手，准确、高效地回答你的问题
              </Text>
            </div>
          ) : (
            <div className="w-full max-w-[784px] mx-auto px-10 sm:px-12 cursor-default">
              <Space direction="vertical" size={28} style={{ width: "100%" }}>
                {normalizedChatMessageInfos.map((info, index) => {
                  const msg = info.message;

                  return (
                    <ChatMessageItem
                      key={getChatMessageRenderKey(info)}
                      message={msg}
                      primaryColor={token.colorPrimary}
                      tertiaryTextColor={token.colorTextTertiary}
                      questionBorderRadius={questionBorderRadius}
                      answerBorderRadius={answerBorderRadius}
                      onEditQuestion={handleEditQuestion}
                      onForkAnswer={handleForkAnswer}
                      forking={forkingMessageId === msg.id}
                      onSelectSource={handleSelectSource}
                      lastIndex={
                        index === normalizedChatMessageInfos.length - 1
                      }
                      editing={editingMessageId === msg.id}
                      editValue={editQuestion}
                      onEditChange={setEditQuestion}
                      onEditSubmit={handleInlineEditSubmit}
                      onEditCancel={handleCancelEdit}
                      isRequesting={isRequesting}
                    />
                  );
                })}
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
              onSubmit={handleSubmitQuestion}
              loading={isRequesting}
              onCancel={handleCancel}
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
