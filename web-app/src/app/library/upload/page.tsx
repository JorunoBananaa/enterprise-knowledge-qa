"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Form,
  Input,
  Select,
  Button,
  Upload,
  Typography,
  Alert,
  Card,
} from "antd";
import { InboxOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { apiFetch } from "@/lib/api";

const { Title } = Typography;
const { Dragger } = Upload;

export default function UploadPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const handleSubmit = async (values: {
    title: string;
    category_id: string;
  }) => {
    if (!file) return;
    setError("");
    setUploading(true);

    const formData = new FormData();
    formData.append("title", values.title);
    formData.append("category_id", values.category_id);
    formData.append("file", file);

    try {
      await apiFetch("/documents", {
        method: "POST",
        body: formData,
      });
      router.push("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  };

  const uploadProps: UploadProps = {
    maxCount: 1,
    beforeUpload: (file) => {
      setFile(file);
      return false; // prevent auto upload
    },
    onRemove: () => setFile(null),
    accept: ".pdf,.docx,.pptx,.xlsx",
  };

  return (
    <div style={{ maxWidth: 600, margin: "0 auto" }}>
      <Title level={3}>上传文档</Title>

      {error && (
        <Alert
          message={error}
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
        />
      )}

      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ category_id: "1" }}
        >
          <Form.Item
            name="title"
            label="标题"
            rules={[{ required: true, message: "请输入文档标题" }]}
          >
            <Input placeholder="请输入文档标题" />
          </Form.Item>

          <Form.Item
            name="category_id"
            label="分类"
            rules={[{ required: true, message: "请选择分类" }]}
          >
            <Select options={[{ label: "产品 A", value: "1" }]} />
          </Form.Item>

          <Form.Item label="文件（支持 PDF、Word、PPT、Excel）">
            <Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
              <p className="ant-upload-hint">支持 PDF、Word、PPT、Excel 格式</p>
            </Dragger>
          </Form.Item>

          <Form.Item>
            <div style={{ display: "flex", gap: 12 }}>
              <Button type="primary" htmlType="submit" loading={uploading}>
                {uploading ? "上传中..." : "上传"}
              </Button>
              <Button onClick={() => router.back()}>取消</Button>
            </div>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
