"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Descriptions, Card, Alert } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useApi } from "@/lib/use-api";
import DocumentStatusBadge from "@/components/DocumentStatusBadge";
import PageHeader from "@/components/PageHeader";
import LoadingSpinner from "@/components/LoadingSpinner";

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
  const rawId = params.id;
  const documentId = Array.isArray(rawId) ? rawId[0] : rawId;

  const {
    data: doc,
    loading,
    error,
  } = useApi<Document>(`/documents/${documentId}`);

  if (loading) return <LoadingSpinner />;
  if (error || !doc) {
    return <Alert message="文档未找到" type="warning" showIcon />;
  }

  return (
    <div className="max-w-[800px] mx-auto">
      <Link
        href="/library"
        className="inline-flex items-center gap-1.5 mb-4 text-sm text-zinc-500 hover:text-zinc-800 transition-colors"
      >
        <ArrowLeftOutlined />
        返回知识库
      </Link>

      <PageHeader
        label="DOCUMENT DETAIL"
        title={doc.title}
        description={
          <>
            {doc.file_type} · 上传者 #{doc.uploader_id}
          </>
        }
      />

      <Card>
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="文件类型">
            {doc.file_type}
          </Descriptions.Item>
          <Descriptions.Item label="分类 ID">
            {doc.category_id}
          </Descriptions.Item>
          <Descriptions.Item label="审核状态">
            <DocumentStatusBadge status={doc.review_status} />
          </Descriptions.Item>
          <Descriptions.Item label="索引状态">
            <DocumentStatusBadge status={doc.index_status} />
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
