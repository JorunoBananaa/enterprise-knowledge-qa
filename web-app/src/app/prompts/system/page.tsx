"use client";

import { useEffect, useState } from "react";
import { Form, Input, Button, Card, Typography, App } from "antd";
import { apiFetch } from "@/lib/api";

const { Title } = Typography;
const { TextArea } = Input;

export default function SystemPromptPage() {
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

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <Title level={3}>系统提示词</Title>

      <Card loading={loading}>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="content" label="提示词内容">
            <TextArea rows={6} placeholder="请输入系统提示词内容，可为空..." />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
