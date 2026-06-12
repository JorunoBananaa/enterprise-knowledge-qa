"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Descriptions, Card, Typography, Spin, Alert } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { apiFetch } from "@/lib/api";
import DocumentStatusBadge from "@/components/DocumentStatusBadge";

const { Title } = Typography;

interface Document {
  id: number;
  title: string;
  file_type: string;
  storage_path: string;
  uploader_id: number;
  category_id: number;
  review_status: string;
  index_status: string;
  failure_reason: string | null;
}

export default function DocumentDetailPage() {
  const params = useParams();
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ items: Document[] }>("/documents")
      .then((data) => {
        const found = data.items.find((d) => d.id === Number(params.id));
        setDoc(found || null);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading)
    return (
      <div className="flex justify-center py-20">
        <Spin size="large" />
      </div>
    );
  if (!doc) return <Alert message="文档未找到" type="warning" showIcon />;

  return (
    <div className="max-w-[800px] mx-auto">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 mb-4 text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
      >
        <ArrowLeftOutlined />
        返回知识库
      </Link>

      <div className="page-header">
        <div>
          <div className="page-eyebrow">DOCUMENT DETAIL</div>
          <Title level={3} className="!mb-1">
            {doc.title}
          </Title>
          <p className="page-description !mb-0">
            {doc.file_type} · 上传者 #{doc.uploader_id}
          </p>
        </div>
      </div>

      <Card>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="文件类型">
            {doc.file_type}
          </Descriptions.Item>
          <Descriptions.Item label="分类 ID">
            {doc.category_id}
          </Descriptions.Item>
          <Descriptions.Item label="审核状态">
            <DocumentStatusBadge status={doc.review_status} type="review" />
          </Descriptions.Item>
          <Descriptions.Item label="索引状态">
            <DocumentStatusBadge status={doc.index_status} type="index" />
          </Descriptions.Item>
          <Descriptions.Item label="存储路径" span={2}>
            <code>{doc.storage_path}</code>
          </Descriptions.Item>
        </Descriptions>

        {doc.failure_reason && (
          <Alert
            message="失败原因"
            description={doc.failure_reason}
            type="error"
            showIcon
            className="!mt-4"
          />
        )}
      </Card>
    </div>
  );
}
