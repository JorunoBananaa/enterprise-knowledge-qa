"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { InboxOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useApi } from "@/lib/use-api";

const { Title } = Typography;
const { Dragger } = Upload;

export default function UploadPage() {
  const router = useRouter();
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);

  const {
    loading: uploading,
    error,
    run: handleSubmit,
  } = useApi("/documents", {
    method: "POST",
    manual: true,
    onSuccess: () => {
      router.push("/library");
    },
  });

  const wrappedSubmit = (values: { title: string; category_id: string }) => {
    if (!file) throw new Error("请选择文件");
    const formData = new FormData();
    formData.append("title", values.title);
    formData.append("category_id", values.category_id);
    formData.append("file", file);
    handleSubmit(formData);
  };

  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : "上传失败"
    : "";

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
    <div className="max-w-[680px] mx-auto">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 mb-4 text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
      >
        <ArrowLeftOutlined />
        返回知识库
      </Link>

      <div className="page-header">
        <div>
          <div className="page-eyebrow">UPLOAD</div>
          <Title level={3} className="!mb-1">
            上传文档
          </Title>
          <p className="page-description !mb-0">
            上传 PDF、Word、PPT、Excel 文件到知识库，提交后将进入审核流程
          </p>
        </div>
      </div>

      {errorMessage && (
        <Alert message={errorMessage} type="error" showIcon className="!mb-4" />
      )}

      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={wrappedSubmit}
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

          <Form.Item className="!mb-0">
            <div className="flex gap-3">
              <Button
                type="primary"
                htmlType="submit"
                loading={uploading}
                size="large"
              >
                {uploading ? "上传中..." : "上传到知识库"}
              </Button>
              <Button size="large" onClick={() => router.back()}>
                取消
              </Button>
            </div>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
