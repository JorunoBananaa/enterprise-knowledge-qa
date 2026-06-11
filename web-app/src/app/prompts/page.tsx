"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Form,
  Input,
  Button,
  Card,
  Tag,
  Typography,
  Tabs,
  Switch,
  Spin,
  App,
} from "antd";
import { SettingOutlined, FileTextOutlined } from "@ant-design/icons";
import { apiFetch } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-client";
import type { CurrentUser } from "@/lib/auth-client";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ── Types ────────────────────────────────────────────────────────────

interface SystemPromptItem {
  id: number;
  version: number;
  content: string;
  status: string;
}

interface UserPrompt {
  id?: number;
  content: string;
  enabled: boolean;
}

// ── System Prompt Panel ──────────────────────────────────────────────

function SystemPromptPanel() {
  const [prompts, setPrompts] = useState<SystemPromptItem[]>([]);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const { message } = App.useApp();

  const fetchPrompts = useCallback(async () => {
    try {
      const data = await apiFetch<SystemPromptItem[]>("/prompts/system");
      setPrompts(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const handleCreate = async (values: { content: string }) => {
    if (!values.content.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch("/prompts/system", {
        method: "POST",
        body: JSON.stringify(values),
      });
      form.resetFields();
      message.success("新提示词版本已创建");
      fetchPrompts();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建提示词失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (version: number) => {
    try {
      await apiFetch(`/prompts/system/${version}/activate`, { method: "POST" });
      message.success(`版本 ${version} 已激活`);
      fetchPrompts();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "激活失败");
    }
  };

  return (
    <div>
      <Paragraph type="secondary" className="!mb-4">
        系统提示词定义了回答的基础规则（引用、证据等），对所有问答生效。
      </Paragraph>

      <Card className="!mb-6">
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="content"
            label="新提示词版本"
            rules={[{ required: true, message: "请输入系统提示词内容" }]}
          >
            <TextArea rows={4} placeholder="请输入系统提示词内容..." />
          </Form.Item>
          <Form.Item className="!mb-0">
            <Button type="primary" htmlType="submit" loading={submitting}>
              创建版本
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Title level={5}>版本历史</Title>
      {loading ? (
        <Text type="secondary">加载中...</Text>
      ) : prompts.length === 0 ? (
        <Text type="secondary">暂无提示词版本。</Text>
      ) : (
        prompts.map((p) => (
          <Card key={p.id} size="small" className="!mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Text strong>v{p.version}</Text>
                <Tag color={p.status === "active" ? "green" : "default"}>
                  {p.status === "active" ? "已激活" : p.status}
                </Tag>
              </div>
              {p.status !== "active" && (
                <Button size="small" onClick={() => handleActivate(p.version)}>
                  激活
                </Button>
              )}
            </div>
            <pre className="whitespace-pre-wrap font-sans text-[13px] text-gray-500 m-0">
              {p.content}
            </pre>
          </Card>
        ))
      )}
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
    apiFetch<UserPrompt | { content: string; enabled: boolean }>("/prompts/me")
      .then((data) => {
        form.setFieldsValue({
          content: data.content || "",
          enabled: data.enabled ?? true,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [form]);

  const handleSave = async (values: { content: string; enabled: boolean }) => {
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
        自定义回答的风格和格式，仅对你本人可见。系统规则（引用、证据）不会被覆盖。
      </Paragraph>

      <Card>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="content" label="提示词内容">
            <TextArea
              rows={5}
              placeholder="例如：使用要点列表，答案不超过 200 字。"
            />
          </Form.Item>
          <Form.Item
            name="enabled"
            label="启用个人提示词"
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
          <Form.Item className="!mb-0">
            <Button type="primary" htmlType="submit" loading={saving}>
              保存提示词
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
