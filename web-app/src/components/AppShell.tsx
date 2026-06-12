"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  App,
  Button,
  Layout,
  Popconfirm,
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
import { apiFetch } from "@/lib/api";
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
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [qaSessions, setQaSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (pathname === "/login") {
      setLoading(false);
      return;
    }

    getCurrentUser()
      .then((u) => {
        setUser(u);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        router.replace(buildLoginUrl(pathname));
      });
  }, [pathname, router]);

  const handleDeleteSession = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await apiFetch(`/qa/sessions/${id}`, { method: "DELETE" });
      message.success("会话已删除");
      if (currentSessionId === String(id)) {
        setCurrentSessionId(null);
        router.push("/qa");
      }
      loadQaSessions();
      window.dispatchEvent(new Event("qa:sessions-updated"));
    } catch {
      message.error("删除会话失败");
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore network errors during logout
    }
    setUser(null);
    router.push("/login");
  };

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

  useEffect(() => {
    const syncSessionId = () => {
      setCurrentSessionId(
        new URLSearchParams(window.location.search).get("session_id"),
      );
    };
    const handleSessionSelected = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: number | null }>)
        .detail;
      if (detail && "sessionId" in detail) {
        setCurrentSessionId(
          detail.sessionId === null || detail.sessionId === undefined
            ? null
            : String(detail.sessionId),
        );
        return;
      }
      syncSessionId();
    };

    syncSessionId();
    window.addEventListener("popstate", syncSessionId);
    window.addEventListener("qa:session-selected", handleSessionSelected);
    return () => {
      window.removeEventListener("popstate", syncSessionId);
      window.removeEventListener("qa:session-selected", handleSessionSelected);
    };
  }, [pathname]);

  const loadQaSessions = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiFetch<SessionItem[]>("/qa/sessions");
      setQaSessions(data);
    } catch {
      // The shell should stay usable even when the session list cannot load.
    }
  }, [user]);

  useEffect(() => {
    loadQaSessions();
  }, [loadQaSessions, currentSessionId]);

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

  if (loading) {
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
          <Link href="/qa" className="app-shell-brand">
            <span className="app-shell-brand-icon">
              <BookOutlined />
            </span>
            <span className="app-shell-brand-copy">
              <span className="app-shell-brand-title">知识中枢</span>
              <span className="app-shell-brand-subtitle">企业知识库助手</span>
            </span>
          </Link>

          <Link
            href="/qa"
            className="app-sidebar-new"
            onClick={() => setCurrentSessionId(null)}
          >
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
              <QuestionCircleOutlined />
            </div>
            {qaSessions.length === 0 ? (
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
                      <Link
                        href={`/qa?session_id=${session.id}`}
                        onClick={() => setCurrentSessionId(String(session.id))}
                        className="app-sidebar-session-link"
                      >
                        <span className="app-sidebar-session-title">
                          {session.title || "新会话"}
                        </span>
                      </Link>
                      <Popconfirm
                        title="确定删除此会话？"
                        description="删除后不可恢复"
                        onConfirm={(e) =>
                          handleDeleteSession(
                            session.id,
                            e as unknown as React.MouseEvent,
                          )
                        }
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
        <App>{children}</App>
      </Content>
    </Layout>
  );
}
