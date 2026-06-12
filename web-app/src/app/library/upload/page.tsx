"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Form, Input, Select, Button, Upload, Alert, Card, Spin } from "antd";
import { InboxOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import type { UploadProps } from "antd";
import { useApi } from "@/lib/use-api";
import PageHeader from "@/components/PageHeader";

const { Dragger } = Upload;

export default function UploadPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [form] = Form.useForm();
  const [file, setFile] = useState<File | null>(null);

  // 从 URL 参数预选分类
  const presetCategoryId = searchParams.get("categoryId");
  useEffect(() => {
    if (presetCategoryId) {
      form.setFieldValue("category_id", presetCategoryId);
    }
  }, [presetCategoryId, form]);

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

  // ── fetch categories for dropdown ──
  const { data: catData } = useApi<{ items: { id: number; name: string }[] }>(
    "/categories",
  );
  const categories = catData?.items ?? [];

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

      <PageHeader
        label="UPLOAD"
        title="上传文档"
        description="上传 PDF、Word、PPT、Excel 文件到知识库，提交后将进入审核流程"
      />

      {errorMessage && (
        <Alert message={errorMessage} type="error" showIcon className="!mb-4" />
      )}

      <Card>
        <Spin spinning={uploading} tip="正在上传并处理文档...">
          <Form form={form} layout="vertical" onFinish={wrappedSubmit}>
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
              <Select
                placeholder="请选择分类"
                options={categories.map((c) => ({
                  label: c.name,
                  value: String(c.id),
                }))}
              />
            </Form.Item>

            <Form.Item label="文件（支持 PDF、Word、PPT、Excel）">
              <Dragger {...uploadProps}>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">
                  支持 PDF、Word、PPT、Excel 格式
                </p>
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
        </Spin>
      </Card>
    </div>
  );
}
