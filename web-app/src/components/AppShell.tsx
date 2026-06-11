"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Layout, Menu, Button, Space, Typography, App } from "antd";
import {
  BookOutlined,
  QuestionCircleOutlined,
  AuditOutlined,
  TeamOutlined,
  UserOutlined,
  LogoutOutlined,
  FileTextOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { clearToken, isLoggedIn, parseToken } from "@/lib/auth";

const { Header, Content } = Layout;
const { Text } = Typography;

interface ShellUser {
  username: string;
  role: string;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authState, setAuthState] = useState<{
    loggedIn: boolean;
    user: ShellUser | null;
  }>({
    loggedIn: false,
    user: null,
  });

  useEffect(() => {
    setAuthState({
      loggedIn: isLoggedIn(),
      user: parseToken(),
    });
  }, [pathname]);

  const { loggedIn, user } = authState;

  const handleLogout = () => {
    clearToken();
    setAuthState({ loggedIn: false, user: null });
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

  const menuItems = useMemo(() => {
    const items: any[] = [
      // ── 业务操作 ──
      {
        key: "/qa",
        icon: <QuestionCircleOutlined />,
        label: (
          <Link
            href="/qa"
            style={{
              fontSize: 18,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            企业知识问答
          </Link>
        ),
      },
      {
        key: "/library",
        icon: <BookOutlined />,
        label: <Link href="/library">知识库</Link>,
      },
      {
        key: "/prompts",
        icon: <FileTextOutlined />,
        label: <Link href="/prompts">提示词</Link>,
      },
    ];

    if (user?.role === "admin") {
      // ── 系统配置 ──
      items.push(
        { type: "divider" as const },
        {
          key: "/llm-configs",
          icon: <RobotOutlined />,
          label: <Link href="/llm-configs">大模型管理</Link>,
        },
        // ── 运营管理 ──
        {
          key: "/review",
          icon: <AuditOutlined />,
          label: <Link href="/review">审核管理</Link>,
        },
        {
          key: "/users",
          icon: <TeamOutlined />,
          label: <Link href="/users">用户管理</Link>,
        },
      );
    }

    return items;
  }, [user]);

  if (!loggedIn) {
    return <App>{children}</App>;
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: "#001529",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flex: 1,
          }}
        >
          <Menu
            theme="dark"
            mode="horizontal"
            selectedKeys={[selectedKey]}
            items={menuItems}
            style={{ flex: 1, minWidth: 0 }}
          />
        </div>
        <Space>
          <Text style={{ color: "rgba(255,255,255,0.65)" }}>
            <UserOutlined /> {user?.username}
          </Text>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            退出登录
          </Button>
        </Space>
      </Header>
      <Content
        style={{ padding: 24, maxWidth: 1200, margin: "0 auto", width: "100%" }}
      >
        <App>{children}</App>
      </Content>
    </Layout>
  );
}
