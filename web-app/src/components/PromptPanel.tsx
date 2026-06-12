"use client";

import { Form, Input, Button, Card, Typography, Spin, App } from "antd";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { apiFetch } from "@/lib/api";

const { Paragraph } = Typography;
const { TextArea } = Input;

interface PromptPanelProps {
  /** API 端点，如 "/prompts/system" 或 "/prompts/me" */
  endpoint: string;
  /** 提示说明文字 */
  description: string;
  /** TextArea placeholder */
  placeholder?: string;
}

/**
 * 提示词编辑面板 — SystemPromptPanel 与 PersonalPromptPanel 的通用抽取。
 * 两个面板仅端点与文案不同，其余结构完全一致。
 */
export default function PromptPanel({
  endpoint,
  description,
  placeholder,
}: PromptPanelProps) {
  const [form] = Form.useForm();
  const { message } = App.useApp();

  const { loading } = useRequest(async () => {
    const data = await apiFetch<{ content: string }>(endpoint);
    form.setFieldsValue({ content: data.content || "" });
  });

  const { loading: saving, run: handleSave } = useApi(endpoint, {
    method: "PUT",
    manual: true,
    onSuccess: () => {
      message.success("提示词已保存");
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
          {description}
        </Paragraph>
      </div>

      <Card className="[&_.ant-card-body]:!p-5 [&_textarea.ant-input]:!min-h-[220px] [&_textarea.ant-input]:!leading-[1.75]">
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="content" label="提示词内容">
            <TextArea rows={8} placeholder={placeholder} />
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
