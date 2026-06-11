"use client";

import { useEffect, useState } from "react";
import {
  Form,
  Input,
  Button,
  Card,
  Typography,
  Tabs,
  Spin,
  App,
} from "antd";
import { SettingOutlined, FileTextOutlined } from "@ant-design/icons";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-client";
import type { CurrentUser } from "@/lib/auth-client";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ── System Prompt Panel ──────────────────────────────────────────────

function SystemPromptPanel() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    apiFetch<{ content: string }>("/prompts/system")
      .then((data) => form.setFieldsValue({ content: data.content || "" }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [form]);

  const handleSave = async (values: { content: string }) => {
    setSaving(true);
    try {
      await apiFetch("/prompts/system", {
        method: "PUT",
        body: JSON.stringify(values),
      });
      message.success("系统提示词已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spin tip="加载中..." />
      </div>
    );
  }

  return (
    <div>
      <Paragraph type="secondary" className="!mb-4">
        系统提示词定义了回答的基础规则，对所有问答生效。
      </Paragraph>

      <Card>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="content" label="提示词内容">
            <TextArea rows={6} placeholder="请输入系统提示词内容，可为空..." />
          </Form.Item>
          <Form.Item className="!mb-0">
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    apiFetch<{ content: string }>("/prompts/me")
      .then((data) => {
        form.setFieldsValue({ content: data.content || "" });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [form]);

  const handleSave = async (values: { content: string }) => {
    setSaving(true);
    try {
      await apiFetch("/prompts/me", {
        method: "PUT",
        body: JSON.stringify(values),
      });
      message.success("个人提示词已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spin tip="加载中..." />
      </div>
    );
  }

  return (
    <div>
      <Paragraph type="secondary" className="!mb-4">
        自定义回答的风格和格式，仅对你本人可见。
      </Paragraph>

      <Card>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="content" label="提示词内容">
            <TextArea
              rows={6}
              placeholder="自定义回答的风格和格式，可为空..."
            />
          </Form.Item>
          <Form.Item className="!mb-0">
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
    <div className="max-w-[780px] mx-auto">
      <div className="mb-5">
        <Title level={3} className="!mb-1">
          <FileTextOutlined className="mr-2 text-blue-500" />
          提示词管理
        </Title>
        <Paragraph type="secondary" className="!mb-0 text-sm">
          {isAdmin
            ? "管理系统全局提示词与个人自定义提示词"
            : "自定义问答风格，让你的回答更符合个人偏好"}
        </Paragraph>
      </div>

      <Tabs
        defaultActiveKey={isAdmin ? "system" : "personal"}
        items={tabItems}
        size="large"
      />
    </div>
  );
}
