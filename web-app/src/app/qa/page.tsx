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
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  Button,
  Card,
  Checkbox,
  Drawer,
  Select,
  Skeleton,
  Space,
  Spin,
  Tag,
  Tree,
  Typography,
  message,
  theme,
} from "antd";
import type { DataNode } from "antd/es/tree";
import {
  ClearOutlined,
  CopyOutlined,
  FileTextOutlined,
  FilterOutlined,
  FolderOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Sender } from "@ant-design/x";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { throttle } from "@/lib/utils";
import { apiFetch, apiFetchStream } from "@/lib/api";

const { Text, Paragraph } = Typography;
const INSUFFICIENT_EVIDENCE_ANSWER =
  "知识库中没有找到足够的信息来回答这个问题。";

// ── types ────────────────────────────────────────────────────────────

interface LLMConfigBrief {
  id: number;
  name: string;
  provider: string;
  model_name: string;
  is_active: boolean;
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

function normalizeMessageAnswer(message: ChatMessageOut): ChatMessageOut {
  if (
    message.result_status === "insufficient_evidence" &&
    !message.answer.trim()
  ) {
    return {
      ...message,
      answer: INSUFFICIENT_EVIDENCE_ANSWER,
    };
  }

  return message;
}

// ── scope selector types ─────────────────────────────────────────────

interface CategoryItem {
  id: number;
  name: string;
  parent_id: number | null;
}

interface DocumentItem {
  id: number;
  title: string;
}

interface CatTreeNode extends DataNode {
  categoryId: number;
  parentId: number | null;
  _children?: CatTreeNode[];
}

function buildCatTree(items: CategoryItem[]): CatTreeNode[] {
  const map = new Map<number, CatTreeNode>();
  const roots: CatTreeNode[] = [];

  for (const item of items) {
    const node: CatTreeNode = {
      key: `cat-${item.id}`,
      title: item.name,
      categoryId: item.id,
      parentId: item.parent_id,
      _children: [],
    };
    map.set(item.id, node);
  }

  for (const node of map.values()) {
    if (node.parentId != null && map.has(node.parentId)) {
      map.get(node.parentId)!._children!.push(node);
    } else {
      roots.push(node);
    }
  }

  const clean = (nodes: CatTreeNode[]) => {
    for (const node of nodes) {
      if (node._children && node._children.length > 0) {
        node.children = node._children;
        clean(node._children);
      }
      delete node._children;
    }
  };
  clean(roots);
  return roots;
}

function replaceCurrentSessionUrl(sessionId: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("session_id", String(sessionId));
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function MarkdownAnswer({ content }: { content: string }) {
  return (
    <div className="qa-answer-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
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
  const searchParams = useSearchParams();
  const sessionIdParam = searchParams.get("session_id");

  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessageOut[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedLlmId, setSelectedLlmId] = useState<number | undefined>(
    undefined,
  );
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

  // ── load categories for scope drawer ──
  const { data: catData } = useApi<{ items: CategoryItem[] }>("/categories");
  const categories = catData?.items ?? [];
  const catTree = useMemo(() => buildCatTree(categories), [categories]);

  // ── documents in active drawer category ──
  const { data: scopeDocsData } = useRequest(
    async () => {
      if (activeDrawerCatId == null) return { items: [] as DocumentItem[] };
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

            // If this is a brand-new session, set it active
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
          <Tag
            className="inline-flex items-center gap-1.5 m-0 border-0 rounded-full bg-[#f4f4f5] text-app-text text-xs font-bold cursor-pointer hover:bg-[#e4e4e7] transition-colors select-none"
            onClick={() => setDrawerOpen(true)}
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
                {messages.map((msg) => {
                  const hasAnswer = msg.answer.trim().length > 0;

                  return (
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
                          <UserOutlined
                            style={{ color: "#fff", fontSize: 14 }}
                          />
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
                        {hasAnswer ? (
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
                              <MarkdownAnswer content={msg.answer} />
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
                        ) : (
                          <div className="flex items-end h-8">正在思考...</div>
                        )}
                      </div>
                    </div>
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

      {/* ── Scope Drawer ── */}
      <Drawer
        title={
          <span className="flex items-center gap-2">
            <FilterOutlined className="text-app-primary" />
            <span>选择检索范围</span>
          </span>
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={700}
        styles={{
          body: { padding: 0, display: "flex", flexDirection: "column" },
          header: { borderBottom: "1px solid #f0f0f0" },
        }}
        footer={
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-zinc-500 shrink-0">已选范围：</span>
              {scopeTotal === 0 ? (
                <span className="text-xs text-zinc-400">全部知识库</span>
              ) : (
                <span
                  className="text-xs text-app-primary font-medium truncate"
                  title={scopeLabel}
                >
                  {scopeCategoryIds.length > 0 && (
                    <span>{scopeCategoryIds.length} 个分类</span>
                  )}
                  {scopeCategoryIds.length > 0 &&
                    scopeDocumentIds.length > 0 &&
                    "、"}
                  {scopeDocumentIds.length > 0 && (
                    <span>{scopeDocumentIds.length} 篇文档</span>
                  )}
                </span>
              )}
            </div>
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={() => {
                setScopeCategoryIds([]);
                setScopeDocumentIds([]);
              }}
              disabled={scopeTotal === 0}
            >
              清除筛选
            </Button>
          </div>
        }
      >
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Category Tree */}
          <div className="w-[260px] shrink-0 flex flex-col border-r border-app-border-soft bg-zinc-50/50">
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                知识分类
              </span>
              {scopeCategoryIds.length > 0 && (
                <Tag
                  color="blue"
                  className="!m-0 !text-[10px] !leading-[16px] !px-[6px]"
                >
                  {scopeCategoryIds.length}
                </Tag>
              )}
            </div>
            <div className="flex-1 overflow-auto px-2 pb-3">
              {catTree.length > 0 ? (
                <Tree
                  checkable
                  checkStrictly={false}
                  treeData={catTree}
                  checkedKeys={scopeCategoryIds.map((id) => `cat-${id}`)}
                  onCheck={(checked) => {
                    const keys = (
                      Array.isArray(checked) ? checked : checked.checked
                    ) as string[];
                    const catIds = keys
                      .filter((k: string) => k.startsWith("cat-"))
                      .map((k: string) => Number(k.slice(4)));
                    setScopeCategoryIds(catIds);
                  }}
                  onSelect={(keys) => {
                    const key = keys[0] as string | undefined;
                    if (key?.startsWith("cat-")) {
                      setActiveDrawerCatId(Number(key.slice(4)));
                    }
                  }}
                  titleRender={(node) => {
                    const catNode = node as CatTreeNode;
                    const isSelected = activeDrawerCatId === catNode.categoryId;
                    return (
                      <span
                        className={`flex items-center gap-1.5 text-[13px] ${
                          isSelected ? "text-app-primary font-medium" : ""
                        }`}
                      >
                        <FolderOutlined
                          className={`shrink-0 text-[13px] ${
                            isSelected ? "text-app-primary" : "text-amber-500"
                          }`}
                        />
                        <span className="truncate">
                          {catNode.title as string}
                        </span>
                      </span>
                    );
                  }}
                  defaultExpandAll
                  blockNode
                  showIcon={false}
                  className="[&_.ant-tree-node-content-wrapper]:!pr-2 [&_.ant-tree-node-content-wrapper]:!overflow-hidden"
                />
              ) : (
                <div className="px-3 pt-2">
                  <Skeleton active paragraph={{ rows: 4 }} title={false} />
                </div>
              )}
            </div>
          </div>

          {/* Right: Documents in selected category */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white">
            <div className="px-5 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
                {activeDrawerCatId != null
                  ? `文档 · ${
                      categories.find((c) => c.id === activeDrawerCatId)
                        ?.name ?? ""
                    }`
                  : "文档列表"}
              </span>
              {activeDrawerCatId != null && scopeDocumentIds.length > 0 && (
                <Tag
                  color="blue"
                  className="!m-0 !text-[10px] !leading-[16px] !px-[6px]"
                >
                  {scopeDocumentIds.length}
                </Tag>
              )}
            </div>
            <div className="flex-1 overflow-auto px-5 pb-4">
              {activeDrawerCatId != null ? (
                scopeDocs.length > 0 ? (
                  <Checkbox.Group
                    value={scopeDocumentIds}
                    onChange={(values) =>
                      setScopeDocumentIds(values as number[])
                    }
                    className="w-full"
                  >
                    <Space direction="vertical" className="w-full" size={0}>
                      {scopeDocs.map((doc) => (
                        <div
                          key={doc.id}
                          className={`flex items-center gap-2.5 py-2 px-2.5 rounded-md transition-colors -mx-2.5 ${
                            scopeDocumentIds.includes(doc.id)
                              ? "bg-blue-50/60"
                              : "hover:bg-zinc-50"
                          }`}
                        >
                          <Checkbox value={doc.id} className="!mr-0 shrink-0" />
                          <FileTextOutlined className="text-zinc-400 shrink-0 text-[13px]" />
                          <span className="text-[13px] text-zinc-700 truncate">
                            {doc.title}
                          </span>
                        </div>
                      ))}
                    </Space>
                  </Checkbox.Group>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 gap-2">
                    <FileTextOutlined className="text-4xl text-zinc-200" />
                    <span className="text-sm text-zinc-400">
                      该分类下暂无文档
                    </span>
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <FolderOutlined className="text-4xl text-zinc-200" />
                  <span className="text-sm text-zinc-400">
                    请在左侧点击一个分类查看其文档
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
