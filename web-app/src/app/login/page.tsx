"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Form, Input, Button, Typography, Alert, Card } from "antd";
import { UserOutlined, LockOutlined, BookOutlined } from "@ant-design/icons";
import { useRequest } from "ahooks";
import { login, isSafeNext } from "@/lib/auth-client";

const { Title, Text } = Typography;

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const {
    loading,
    error,
    run: handleSubmit,
  } = useRequest(
    async (values: { username: string; password: string }) => {
      await login(values.username, values.password);
      const next = searchParams.get("next");
      if (isSafeNext(next)) {
        router.replace(next);
      } else {
        router.replace("/qa");
      }
    },
    {
      manual: true,
      onError: () => {
        // error is automatically captured by useRequest
      },
    },
  );

  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : "登录失败"
    : "";

  return (
    <div className="login-page">
      {/* Brand header */}
      <header className="login-header">
        <div className="login-brand">
          <span className="login-brand-icon">
            <BookOutlined />
          </span>
          <div>
            <span className="login-brand-title">企业知识问答</span>
            <span className="login-brand-subtitle">
              Enterprise Knowledge QA
            </span>
          </div>
        </div>
      </header>

      {/* Login card */}
      <main className="login-main">
        <Card className="login-card" styles={{ body: { padding: 40 } }}>
          <div className="login-card-header">
            <Title level={3} style={{ marginBottom: 4 }}>
              欢迎回来
            </Title>
            <Text type="secondary">请登录您的账号以继续</Text>
          </div>

          {errorMessage && (
            <Alert
              message={errorMessage}
              type="error"
              showIcon
              style={{ marginBottom: 24 }}
            />
          )}

          <Form
            name="login"
            onFinish={handleSubmit}
            size="large"
            layout="vertical"
            requiredMark={false}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: "请输入用户名" }]}
            >
              <Input
                prefix={<UserOutlined className="login-input-icon" />}
                placeholder="请输入用户名"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password
                prefix={<LockOutlined className="login-input-icon" />}
                placeholder="请输入密码"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
              >
                {loading ? "登录中..." : "登 录"}
              </Button>
            </Form.Item>
          </Form>
        </Card>

        <Text type="secondary" className="login-footer-text">
          企业级知识库智能问答平台
        </Text>
      </main>

      <style jsx global>{`
        /* ── Login page layout ── */
        .login-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--app-bg);
        }

        /* ── Header ── */
        .login-header {
          display: flex;
          align-items: center;
          height: 56px;
          padding: 0 24px;
          border-bottom: 1px solid var(--app-border);
          background: var(--app-surface);
        }

        .login-brand {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .login-brand-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: var(--app-radius);
          background: var(--app-primary);
          color: #fff;
          font-size: 16px;
          box-shadow: 0 8px 18px rgb(23 23 23 / 0.12);
        }

        .login-brand-title {
          display: block;
          line-height: 18px;
          font-size: 14px;
          font-weight: 700;
          color: var(--app-text);
        }

        .login-brand-subtitle {
          display: block;
          line-height: 16px;
          font-size: 11px;
          color: var(--app-muted);
        }

        /* ── Main content ── */
        .login-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
        }

        /* ── Card ── */
        .login-card {
          width: 400px;
          max-width: 100%;
          border: 1px solid var(--app-border);
          border-radius: var(--app-radius);
          box-shadow: var(--app-shadow-raised);
        }

        .login-card-header {
          text-align: center;
          margin-bottom: 32px;
        }

        /* ── Input icons ── */
        .login-input-icon {
          color: var(--app-muted);
        }

        /* ── Autofill override ── */
        .login-card input:-webkit-autofill,
        .login-card input:-webkit-autofill:hover,
        .login-card input:-webkit-autofill:focus,
        .login-card input:-webkit-autofill:active {
          -webkit-box-shadow: 0 0 0 1000px #fff inset !important;
          -webkit-text-fill-color: rgba(0, 0, 0, 0.88) !important;
          transition: background-color 5000s ease-in-out 0s;
        }

        /* ── Footer text ── */
        .login-footer-text {
          margin-top: 24px;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
