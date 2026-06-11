"use client";

import { useEffect, useState } from "react";
import { Form, Input, Button, Typography, Card, Spin, App } from "antd";
import { apiFetch } from "@/lib/api";

const { Title } = Typography;
const { TextArea } = Input;

export default function PersonalPromptPage() {
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

  if (loading)
    return <Spin tip="加载中..." style={{ display: "block", padding: 48 }} />;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <Title level={3}>个人提示词</Title>

      <Card>
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="content" label="提示词内容">
            <TextArea
              rows={6}
              placeholder="自定义回答的风格和格式，可为空..."
            />
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
