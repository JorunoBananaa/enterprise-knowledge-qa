"use client";

import { useEffect, useState } from "react";
import { Form, Input, Button, Card, Typography, Tabs, Spin, App } from "antd";
import { SettingOutlined, FileTextOutlined } from "@ant-design/icons";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-client";
import type { CurrentUser } from "@/lib/auth-client";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ── System Prompt Panel ──────────────────────────────────────────────

function SystemPromptPanel() {
  const [form] = Form.useForm();
  const { message } = App.useApp();

  const { loading } = useRequest(async () => {
    const data = await apiFetch<{ content: string }>("/prompts/system");
    form.setFieldsValue({ content: data.content || "" });
  });

  const { loading: saving, run: handleSave } = useApi("/prompts/system", {
    method: "PUT",
    manual: true,
    onSuccess: () => {
      message.success("系统提示词已保存");
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "保存失败");
    },
  });

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-[14px] border-l-[3px] border-app-primary rounded-r-app bg-app-primary-soft px-[14px] py-3">
        <Paragraph type="secondary" className="!mb-0">
          系统提示词定义了回答的基础规则，对所有问答生效。
        </Paragraph>
      </div>

      <Card className="[&_.ant-card-body]:!p-5 [&_textarea.ant-input]:!min-h-[220px] [&_textarea.ant-input]:!leading-[1.75]">
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="content" label="提示词内容">
            <TextArea rows={8} placeholder="请输入系统提示词内容，可为空..." />
          </Form.Item>
          <Form.Item className="!mb-0 text-right">
            <Button type="primary" htmlType="submit" loading={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

// ── Personal Prompt Panel ────────────────────────────────────────────

function PersonalPromptPanel() {
  const [form] = Form.useForm();
  const { message } = App.useApp();

  const { loading } = useRequest(async () => {
    const data = await apiFetch<{ content: string }>("/prompts/me");
    form.setFieldsValue({ content: data.content || "" });
  });

  const { loading: saving, run: handleSave } = useApi("/prompts/me", {
    method: "PUT",
    manual: true,
    onSuccess: () => {
      message.success("个人提示词已保存");
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "保存失败");
    },
  });

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spin />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-[14px] border-l-[3px] border-app-primary rounded-r-app bg-app-primary-soft px-[14px] py-3">
        <Paragraph type="secondary" className="!mb-0">
          自定义回答的风格和格式，仅对你本人可见。
        </Paragraph>
      </div>

      <Card className="[&_.ant-card-body]:!p-5 [&_textarea.ant-input]:!min-h-[220px] [&_textarea.ant-input]:!leading-[1.75]">
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="content" label="提示词内容">
            <TextArea
              rows={8}
              placeholder="自定义回答的风格和格式，可为空..."
            />
          </Form.Item>
          <Form.Item className="!mb-0 text-right">
            <Button type="primary" htmlType="submit" loading={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}

// ── Unified Prompt Page ──────────────────────────────────────────────

export default function PromptsPage() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then((u) => {
        setUser(u);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spin size="large" />
      </div>
    );
  }

  const isAdmin = user?.role === "admin";

  const tabItems = [
    {
      key: "personal",
      label: (
        <span className="flex items-center gap-1.5">
          <FileTextOutlined />
          个人提示词
        </span>
      ),
      children: <PersonalPromptPanel />,
    },
  ];

  if (isAdmin) {
    tabItems.unshift({
      key: "system",
      label: (
        <span className="flex items-center gap-1.5">
          <SettingOutlined />
          系统提示词
        </span>
      ),
      children: <SystemPromptPanel />,
    });
  }

  return (
    <div className="w-full max-w-[1060px] mx-auto">
      <div className="flex items-start justify-between gap-4 mb-[18px]">
        <div>
          <div className="mb-1.5 text-app-muted text-xs font-bold tracking-normal">
            PROMPTS
          </div>
          <Title level={3} className="!mb-1">
            <FileTextOutlined className="mr-2 text-zinc-700" />
            提示词管理
          </Title>
          <Paragraph
            type="secondary"
            className="!mb-0 text-app-muted text-sm leading-[1.7]"
          >
            {isAdmin
              ? "管理系统全局提示词与个人自定义提示词"
              : "自定义问答风格，让你的回答更符合个人偏好"}
          </Paragraph>
        </div>
      </div>

      <Tabs
        className="[&_.ant-tabs-nav]:!mb-4 [&_.ant-tabs-tab]:!py-[9px] [&_.ant-tabs-tab]:!px-[13px]"
        defaultActiveKey={isAdmin ? "system" : "personal"}
        items={tabItems}
        size="large"
      />
    </div>
  );
}
