"use client";

import { useEffect, useState } from "react";
import {
  Form,
  Input,
  Button,
  Card,
  Tag,
  Typography,
  App as AntdApp,
} from "antd";
import { apiFetch } from "@/lib/api";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface SystemPrompt {
  id: number;
  version: number;
  content: string;
  status: string;
}

export default function SystemPromptPage() {
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const { message } = AntdApp.useApp();

  const fetchPrompts = async () => {
    try {
      const data = await apiFetch<SystemPrompt[]>("/prompts/system");
      setPrompts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
  }, []);

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
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <Title level={3}>系统提示词</Title>

      <Card style={{ marginBottom: 24 }}>
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item
            name="content"
            label="新提示词版本"
            rules={[{ required: true, message: "请输入系统提示词内容" }]}
          >
            <TextArea rows={4} placeholder="请输入系统提示词内容..." />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {submitting ? "创建中..." : "创建版本"}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Title level={4}>版本历史</Title>
      {loading ? (
        <Text type="secondary">加载中...</Text>
      ) : prompts.length === 0 ? (
        <Text type="secondary">暂无提示词版本。</Text>
      ) : (
        prompts.map((p) => (
          <Card key={p.id} size="small" style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                margin: 0,
                fontSize: 13,
                color: "#666",
              }}
            >
              {p.content}
            </pre>
          </Card>
        ))
      )}
    </div>
  );
}
