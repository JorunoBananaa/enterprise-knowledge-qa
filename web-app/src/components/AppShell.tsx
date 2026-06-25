"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { App, Button, Layout, Modal, Spin, Typography, message } from "antd";
import {
  AuditOutlined,
  BookOutlined,
  FileTextOutlined,
  DeleteOutlined,
  LogoutOutlined,
  PlusSquareOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Conversations, type ConversationItemType } from "@ant-design/x";
import { useXConversations, type ConversationData } from "@ant-design/x-sdk";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { getCurrentUser, logout, buildLoginUrl } from "@/lib/auth-client";
import { pushCurrentSessionUrl } from "@/app/qa/_lib/session-url";

const { Content } = Layout;
const { Text } = Typography;

interface SessionItem {
  id: number;
  title: string | null;
  created_at: string;
  message_count: number;
}

type QAConversationItem = ConversationData & ConversationItemType;

const EMPTY_QA_SESSIONS: SessionItem[] = [];

function toConversationItem(session: SessionItem): QAConversationItem {
  return {
    key: String(session.id),
    label: session.title || "新会话",
  };
}

function areConversationItemsEqual(
  current: QAConversationItem[],
  next: QAConversationItem[],
): boolean {
  if (current.length !== next.length) return false;

  return current.every(
    (item, index) =>
      item.key === next[index].key && item.label === next[index].label,
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    conversations: qaConversations,
    activeConversationKey,
    setActiveConversationKey,
    addConversation,
    removeConversation,
    setConversations,
  } = useXConversations({
    defaultConversations: [],
    defaultActiveConversationKey: "",
  });

  // Track whether the initial user fetch has completed.
  // We must NOT replace the whole component tree with a spinner on
  // subsequent refreshes — that would unmount children (the page) and
  // cause a visible full-page flash on every route change.
  const userFirstLoadDone = useRef(false);

  // ── current user ──
  const { data: user = null, loading: userLoading } = useRequest(
    async () => {
      if (pathname === "/login") return null;
      return getCurrentUser();
    },
    {
      refreshDeps: [pathname],
      onSuccess: () => {
        userFirstLoadDone.current = true;
      },
      onError: () => {
        userFirstLoadDone.current = true;
        if (pathname !== "/login") {
          router.replace(buildLoginUrl(pathname));
        }
      },
    },
  );

  // ── qa sessions ──
  const {
    data: qaSessions = EMPTY_QA_SESSIONS,
    loading: sessionsLoading,
    run: loadQaSessions,
  } = useApi<SessionItem[]>("/qa/sessions", {
    ready: Boolean(user),
    refreshDeps: [Boolean(user)],
  });

  // ── create session ──
  const { loading: creatingSession, run: createQaSession } = useApi<
    SessionItem,
    [],
    "POST"
  >("/qa/sessions", {
    method: "POST",
    manual: true,
    onSuccess: (session) => {
      addConversation(toConversationItem(session), "prepend");
      setActiveConversationKey(String(session.id));
      loadQaSessions();
      window.dispatchEvent(new Event("qa:sessions-updated"));
      router.push(`/qa?session_id=${session.id}`);
    },
    onError: () => {
      message.error("创建会话失败");
    },
  });
  const handleCreateQaSession = useCallback(() => {
    createQaSession();
  }, [createQaSession]);

  // ── delete session ──
  const { run: handleDeleteSession } = useApi(
    (id: number) => `/qa/sessions/${id}`,
    {
      method: "DELETE",
      manual: true,
      onSuccess: (_data, params) => {
        const [id] = params;
        message.success("会话已删除");
        removeConversation(String(id));
        if (currentSessionIdRef.current === String(id)) {
          setActiveConversationKey("");
          router.push("/qa");
        }
        loadQaSessions();
        window.dispatchEvent(new Event("qa:sessions-updated"));
      },
      onError: () => {
        message.error("删除会话失败");
      },
    },
  );

  // Store currentSessionId via ref so the delete callback can read it
  // without depending on useSearchParams at the top level.
  const currentSessionIdRef = useRef<string | null>(null);

  // Callback for SessionHistoryBlock to update the ref
  const handleCurrentSessionIdChange = useCallback((id: string | null) => {
    currentSessionIdRef.current = id;
  }, []);

  // ── logout ──
  const { run: handleLogout } = useRequest(
    async () => {
      await logout();
    },
    {
      manual: true,
      onSuccess: () => {
        router.push("/login");
      },
      onError: () => {
        // ignore network errors during logout
        router.push("/login");
      },
    },
  );

  const selectedKey = useMemo(() => {
    if (pathname.startsWith("/library")) return "/library";
    if (pathname.startsWith("/qa")) return "/qa";
    if (pathname.startsWith("/review")) return "/review";
    if (pathname.startsWith("/prompts")) return "/prompts";
    if (pathname.startsWith("/llm-configs")) return "/llm-configs";
    if (pathname.startsWith("/users")) return "/users";
    return "/qa";
  }, [pathname]);

  const isQaPage = selectedKey === "/qa";

  // ── route transition progress bar ──
  const [navigating, setNavigating] = useState(false);
  const prevPathname = useRef(pathname);
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      setNavigating(true);
      prevPathname.current = pathname;
      const timer = setTimeout(() => setNavigating(false), 600);
      return () => clearTimeout(timer);
    }
  }, [pathname]);

  // ── listen for external session updates ──
  useEffect(() => {
    window.addEventListener("qa:sessions-updated", loadQaSessions);
    return () => {
      window.removeEventListener("qa:sessions-updated", loadQaSessions);
    };
  }, [loadQaSessions]);

  useEffect(() => {
    const nextConversations = qaSessions.map(toConversationItem);
    if (
      areConversationItemsEqual(
        qaConversations as QAConversationItem[],
        nextConversations,
      )
    ) {
      return;
    }

    setConversations(nextConversations);
  }, [qaConversations, qaSessions, setConversations]);

  const navItems = useMemo(() => {
    const items = [
      {
        key: "/library",
        href: "/library",
        icon: BookOutlined,
        label: "知识库",
      },
      {
        key: "/prompts",
        href: "/prompts",
        icon: FileTextOutlined,
        label: "提示词",
      },
    ];

    if (user?.role === "admin") {
      items.push(
        {
          key: "/llm-configs",
          href: "/llm-configs",
          icon: RobotOutlined,
          label: "大模型管理",
        },
        {
          key: "/review",
          href: "/review",
          icon: AuditOutlined,
          label: "审核管理",
        },
        {
          key: "/users",
          href: "/users",
          icon: TeamOutlined,
          label: "用户管理",
        },
      );
    }

    return items;
  }, [user?.role]);

  if (pathname === "/login") {
    return <App>{children}</App>;
  }

  if (!userFirstLoadDone.current) {
    return (
      <Layout className="flex min-h-screen items-center justify-center">
        <Spin size="large" />
      </Layout>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <Layout className="!flex !flex-row min-h-screen bg-white">
      <aside className="sticky top-0 flex w-sidebar shrink-0 flex-col justify-between h-screen border-r border-app-border bg-[#f7f7f8] px-[13px] py-[18px] pb-[14px]">
        <div className="min-h-0">
          <div className="flex shrink-0 items-center gap-2.5 min-w-0 text-app-text cursor-default px-1">
            <span className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-app bg-app-primary text-white shadow-[0_8px_18px_rgb(23_23_23_/_0.12)]">
              <BookOutlined />
            </span>
            <span className="grid">
              <span className="block leading-[18px] text-sm font-bold">
                知识中枢
              </span>
              <span className="block leading-4 text-xs text-app-muted">
                知识库助手
              </span>
            </span>
          </div>

          <Button
            type="primary"
            icon={<PlusSquareOutlined />}
            onClick={handleCreateQaSession}
            loading={creatingSession}
            className="!flex !items-center !justify-start !gap-[9px] !h-7 !w-full !mt-[18px] !mb-4 !rounded-md !bg-app-primary !px-3 !text-sm !font-bold !shadow-none hover:!bg-[#262626]"
          >
            新建回答
          </Button>

          <nav className="grid gap-0.5 mb-[22px]" aria-label="主导航">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = selectedKey === item.key;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`flex items-center gap-2.5 min-h-[38px] rounded-[7px] px-[11px] text-[#575f6c] text-sm font-medium cursor-pointer transition-colors duration-200 ease-out hover:text-app-primary hover:bg-[#efeff0] ${
                    active ? "text-app-primary bg-[#efeff0]" : ""
                  }`}
                >
                  <Icon />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="min-h-0">
            <div className="flex items-center justify-between px-[7px] pb-2.5 text-[#7b8492] text-xs font-semibold">
              <span>历史会话</span>
            </div>
            <SessionHistoryBlock
              conversations={qaConversations as QAConversationItem[]}
              activeConversationKey={activeConversationKey}
              loading={sessionsLoading}
              onActiveConversationKeyChange={setActiveConversationKey}
              onDeleteSession={handleDeleteSession}
              onCurrentSessionIdChange={handleCurrentSessionIdChange}
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-t border-app-border pt-[14px]">
          <span className="inline-flex shrink-0 items-center justify-center w-8 h-8 rounded-full bg-white text-app-primary text-[13px] font-extrabold">
            {(user.display_name || user.username).slice(0, 1).toUpperCase()}
          </span>
          <span className="grid flex-1 min-w-0">
            <Text ellipsis className="text-app-text text-[13px] font-bold">
              {user.display_name || user.username}
            </Text>
            <span className="text-app-muted text-xs">
              {user.role === "admin" ? "管理员" : "知识库成员"}
            </span>
          </span>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            aria-label="退出登录"
          />
        </div>
      </aside>

      <Content
        className={`flex-1 min-w-0 w-full min-h-screen bg-app-bg px-8 py-7 ${
          isQaPage ? "!p-0" : ""
        }`}
      >
        {/* Route transition progress bar */}
        <div
          className={`fixed top-0 left-0 z-[9999] h-[3px] w-0 bg-gradient-to-r from-[#171717] to-[#525252] rounded-r-[3px] opacity-0 transition-opacity duration-200 ease pointer-events-none ${
            navigating ? "opacity-100 animate-nav-progress-slide" : ""
          }`}
        />
        <App>{children}</App>
      </Content>
    </Layout>
  );
}

// ── SessionHistoryBlock ──────────────────────────────────────────────
// Isolates useSearchParams() inside its own <Suspense> boundary so that
// route changes don't trigger the outer layout Suspense / full-page reload.

interface SessionHistoryBlockProps {
  conversations: QAConversationItem[];
  activeConversationKey: string;
  loading: boolean;
  onActiveConversationKeyChange: (key: string) => boolean;
  onDeleteSession: (id: number) => void;
  onCurrentSessionIdChange: (id: string | null) => void;
}

function SessionHistoryBlock({
  conversations,
  activeConversationKey,
  loading,
  onActiveConversationKeyChange,
  onDeleteSession,
  onCurrentSessionIdChange,
}: SessionHistoryBlockProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const currentSessionId = searchParams.get("session_id");

  const handleOpenSession = useCallback(
    (sessionKey: string) => {
      const sessionId = Number(sessionKey);
      if (!Number.isFinite(sessionId)) return;

      if (activeConversationKey !== sessionKey) {
        onActiveConversationKeyChange(sessionKey);
      }
      if (pathname === "/qa") {
        pushCurrentSessionUrl(sessionId);
        return;
      }

      router.push(`/qa?session_id=${sessionId}`);
    },
    [
      activeConversationKey,
      onActiveConversationKeyChange,
      pathname,
      router,
    ],
  );
  const handleDeleteConversation = useCallback(
    (conversation: ConversationItemType) => {
      const sessionId = Number(conversation.key);
      if (!Number.isFinite(sessionId)) return;

      Modal.confirm({
        title: "确定删除此会话？",
        content: "删除后不可恢复",
        okText: "删除",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => onDeleteSession(sessionId),
      });
    },
    [onDeleteSession],
  );

  // Keep the parent in sync so the delete callback can check the current id
  useEffect(() => {
    onCurrentSessionIdChange(currentSessionId);

    const nextActiveKey = currentSessionId ?? "";
    if (activeConversationKey !== nextActiveKey) {
      onActiveConversationKeyChange(nextActiveKey);
    }
  }, [
    activeConversationKey,
    currentSessionId,
    onActiveConversationKeyChange,
    onCurrentSessionIdChange,
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center px-2 py-3">
        <Spin size="small" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="px-2 py-2.5 text-app-muted text-[13px]">暂无历史会话</div>
    );
  }

  return (
    <Conversations
      items={conversations}
      activeKey={activeConversationKey || undefined}
      onActiveChange={handleOpenSession}
      className="max-h-[calc(100vh-354px)] overflow-hidden overflow-y-auto pr-0.5"
      classNames={{
        item: "!min-h-[38px] !rounded-lg !px-[11px] !py-1.5 !text-[13px] !font-bold",
      }}
      menu={(conversation) => ({
        items: [
          {
            key: "delete",
            label: "删除",
            icon: <DeleteOutlined />,
            danger: true,
          },
        ],
        onClick: ({ key, domEvent }) => {
          domEvent.stopPropagation();
          if (key === "delete") {
            handleDeleteConversation(conversation);
          }
        },
      })}
    />
  );
}
