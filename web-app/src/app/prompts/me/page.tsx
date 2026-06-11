"use client";

import { useEffect, useState } from "react";
import { Form, Input, Switch, Button, Typography, Card, Spin, App } from "antd";
import { apiFetch } from "@/lib/api";

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

interface UserPrompt {
  id?: number;
  content: string;
  enabled: boolean;
}

export default function PersonalPromptPage() {
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

  if (loading)
    return <Spin tip="加载中..." style={{ display: "block", padding: 48 }} />;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <Title level={3}>个人提示词</Title>
      <Paragraph type="secondary">
        自定义回答的风格和格式。系统规则（引用、证据）不会被覆盖。
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

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              {saving ? "保存中..." : "保存提示词"}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
