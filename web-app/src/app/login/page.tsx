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
        // useRequest 会自动捕获错误
      },
    },
  );

  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : "登录失败"
    : "";

  return (
    <div className="min-h-screen flex flex-col bg-app-bg">
      {/* 品牌头部 */}
      <header className="flex items-center h-14 px-6 border-b border-app-border bg-white">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-app bg-app-primary text-white text-base shadow-[0_8px_18px_rgb(23_23_23_/_0.12)]">
            <BookOutlined />
          </span>
          <div>
            <span className="block leading-[18px] text-sm font-bold text-app-text">
              知识库问答
            </span>
            <span className="block leading-4 text-[11px] text-app-muted">
              Knowledge QA
            </span>
          </div>
        </div>
      </header>

      {/* 登录卡片 */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <Card
          className="!w-[400px] !max-w-full !border-app-border !rounded-app !shadow-app-raised [&_input:-webkit-autofill]:![shadow:0_0_0_1000px_#fff_inset] [&_input:-webkit-autofill]:![text-fill-color:rgba(0,0,0,0.88)] [&_input:-webkit-autofill]:![transition:background-color_5000s_ease-in-out_0s]"
          styles={{ body: { padding: 40 } }}
        >
          <div className="text-center mb-8">
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
                prefix={<UserOutlined className="text-app-muted" />}
                placeholder="请输入用户名"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: "请输入密码" }]}
            >
              <Input.Password
                prefix={<LockOutlined className="text-app-muted" />}
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

        <Text type="secondary" className="mt-6 text-xs">
          知识库智能问答平台
        </Text>
      </main>
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
