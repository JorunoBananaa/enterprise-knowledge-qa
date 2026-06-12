"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  App,
  Button,
  Layout,
  Popconfirm,
  Skeleton,
  Spin,
  Typography,
  message,
} from "antd";
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
  UserOutlined,
} from "@ant-design/icons";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { getCurrentUser, logout, buildLoginUrl } from "@/lib/auth-client";
import type { CurrentUser } from "@/lib/auth-client";

const { Content } = Layout;
const { Text } = Typography;

interface SessionItem {
  id: number;
  title: string | null;
  created_at: string;
  message_count: number;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSessionId = searchParams.get("session_id");

  // ── current user ──
  const { data: user = null, loading: userLoading } = useRequest(
    async () => {
      if (pathname === "/login") return null;
      return getCurrentUser();
    },
    {
      refreshDeps: [pathname],
      onError: () => {
        if (pathname !== "/login") {
          router.replace(buildLoginUrl(pathname));
        }
      },
    },
  );

  // ── qa sessions ──
  const { data: qaSessions = [], loading: sessionsLoading, run: loadQaSessions } = useApi<SessionItem[]>(
    "/qa/sessions",
    {
      refreshDeps: [!!user],
    },
  );

  // ── delete session ──
  const { run: handleDeleteSession } = useApi(
    (id: number) => `/qa/sessions/${id}`,
    {
      method: "DELETE",
      manual: true,
      onSuccess: (_data, params) => {
        const [id] = params;
        message.success("会话已删除");
        if (currentSessionId === String(id)) {
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

  const navItems = useMemo(() => {
    const items = [
      {
        key: "/library",
        href: "/library",
        icon: BookOutlined,
        label: "知识库管理",
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
  }, [user]);

  if (pathname === "/login") {
    return <App>{children}</App>;
  }

  if (userLoading) {
    return (
      <Layout
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Spin size="large" />
      </Layout>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <Layout className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-top">
          <div className="app-shell-brand">
            <span className="app-shell-brand-icon">
              <BookOutlined />
            </span>
            <span className="app-shell-brand-copy">
              <span className="app-shell-brand-title">知识中枢</span>
              <span className="app-shell-brand-subtitle">企业知识库助手</span>
            </span>
          </div>

          <Link href="/qa" className="app-sidebar-new">
            <PlusSquareOutlined />
            <span>新建问答</span>
          </Link>

          <nav className="app-sidebar-nav" aria-label="主导航">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = selectedKey === item.key;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`app-sidebar-nav-item ${
                    active ? "app-sidebar-nav-item-active" : ""
                  }`}
                >
                  <Icon />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="app-sidebar-history">
            <div className="app-sidebar-section-title">
              <span>历史会话</span>
            </div>
            {sessionsLoading ? (
              <div className="app-sidebar-session-list" style={{ padding: "0 8px" }}>
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton
                    key={i}
                    active
                    paragraph={{ rows: 1, width: "70%" }}
                    title={false}
                    style={{ padding: "0 4px", marginBottom: 4 }}
                  />
                ))}
              </div>
            ) : qaSessions.length === 0 ? (
              <div className="app-sidebar-empty">暂无历史会话</div>
            ) : (
              <div className="app-sidebar-session-list">
                {qaSessions.map((session) => {
                  const active = currentSessionId === String(session.id);
                  return (
                    <div
                      key={session.id}
                      className={`app-sidebar-session ${
                        active ? "app-sidebar-session-active" : ""
                      }`}
                    >
                      <div
                        onClick={() =>
                          router.push(`/qa?session_id=${session.id}`)
                        }
                        className="app-sidebar-session-link"
                      >
                        <span className="app-sidebar-session-title">
                          {session.title || "新会话"}
                        </span>
                      </div>
                      <Popconfirm
                        title="确定删除此会话？"
                        description="删除后不可恢复"
                        onConfirm={() => handleDeleteSession(session.id)}
                        onCancel={(e) => {
                          (e as React.MouseEvent).stopPropagation();
                        }}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                      >
                        <button
                          type="button"
                          className="app-sidebar-session-delete"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="删除会话"
                        >
                          <DeleteOutlined />
                        </button>
                      </Popconfirm>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="app-sidebar-user">
          <span className="app-sidebar-avatar">
            {(user.display_name || user.username).slice(0, 1).toUpperCase()}
          </span>
          <span className="app-sidebar-user-copy">
            <Text ellipsis className="app-sidebar-user-name">
              {user.display_name || user.username}
            </Text>
            <span className="app-sidebar-user-role">
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
        className={`app-shell-content ${
          isQaPage ? "app-shell-content-qa" : ""
        }`}
      >
        {/* Route transition progress bar */}
        <div
          className={`app-nav-progress ${navigating ? "app-nav-progress-active" : ""}`}
        />
        <App>{children}</App>
      </Content>
    </Layout>
  );
}
