"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table,
  Button,
  Select,
  Space,
  Typography,
  Card,
  Empty,
  Spin,
} from "antd";
import { PlusOutlined, SearchOutlined, BookOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useApi } from "@/lib/use-api";
import DocumentStatusBadge from "@/components/DocumentStatusBadge";

const { Title } = Typography;

interface Document {
  id: number;
  title: string;
  file_type: string;
  review_status: string;
  index_status: string;
  uploader_id: number;
  category_id: number;
}

const columns: ColumnsType<Document> = [
  {
    title: "标题",
    dataIndex: "title",
    key: "title",
    render: (text: string, record: Document) => (
      <Link href={`/library/${record.id}`} style={{ fontWeight: 500 }}>
        {text}
      </Link>
    ),
  },
  {
    title: "类型",
    dataIndex: "file_type",
    key: "file_type",
    width: 100,
  },
  {
    title: "审核",
    dataIndex: "review_status",
    key: "review_status",
    width: 100,
    render: (status: string) => (
      <DocumentStatusBadge status={status} type="review" />
    ),
  },
  {
    title: "索引",
    dataIndex: "index_status",
    key: "index_status",
    width: 100,
    render: (status: string) => (
      <DocumentStatusBadge status={status} type="index" />
    ),
  },
];

export default function LibraryPage() {
  const [category, setCategory] = useState<string>();
  const [status, setStatus] = useState<string>();

  const {
    data: docsData,
    loading,
    run: fetchDocs,
  } = useApi<{ items: Document[]; total: number }>(
    () => {
      const params = new URLSearchParams();
      if (category) params.set("category_id", category);
      if (status) params.set("review_status", status);
      return `/documents?${params.toString()}`;
    },
    { refreshDeps: [category, status] },
  );

  const handleFilter = () => {
    fetchDocs();
  };

  const docs = docsData?.items ?? [];
  const total = docsData?.total ?? 0;

  return (
    <div className="max-w-[1060px] mx-auto">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">KNOWLEDGE BASE</div>
          <Title level={3} className="!mb-1">
            <BookOutlined className="mr-2 text-zinc-700" />
            知识库
          </Title>
          <p className="page-description !mb-0">
            管理企业知识文档，上传后经审核即可加入检索索引
          </p>
        </div>
        <Link href="/library/upload">
          <Button type="primary" size="large" icon={<PlusOutlined />}>
            上传文档
          </Button>
        </Link>
      </div>

      <Card className="!mb-4">
        <Space wrap>
          <Select
            placeholder="选择分类"
            allowClear
            style={{ width: 160 }}
            value={category || undefined}
            onChange={(v) => setCategory(v)}
            options={[{ label: "产品 A", value: "1" }]}
          />
          <Select
            placeholder="审核状态"
            allowClear
            style={{ width: 160 }}
            value={status || undefined}
            onChange={(v) => setStatus(v)}
            options={[
              { label: "待审核", value: "pending_review" },
              { label: "已通过", value: "approved" },
              { label: "已驳回", value: "rejected" },
            ]}
          />
          <Button
            icon={<SearchOutlined />}
            loading={loading}
            onClick={handleFilter}
          >
            应用筛选
          </Button>
        </Space>
      </Card>

      {loading ? (
        <Spin spinning>
          <div style={{ minHeight: 200 }} />
        </Spin>
      ) : docs.length === 0 ? (
        <Empty description="暂无文档，请上传文档开始使用" />
      ) : (
        <Table
          columns={columns}
          dataSource={docs}
          rowKey="id"
          loading={loading}
          pagination={{
            total,
            pageSize: 20,
            showTotal: (t) => `共 ${t} 篇文档`,
          }}
        />
      )}
    </div>
  );
}
