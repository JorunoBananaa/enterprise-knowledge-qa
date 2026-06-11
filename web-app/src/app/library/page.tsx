"use client";

import { useEffect, useState } from "react";
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
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { apiFetch } from "@/lib/api";
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
  const [docs, setDocs] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [filtering, setFiltering] = useState(false);
  const [category, setCategory] = useState<string>();
  const [status, setStatus] = useState<string>();

  const fetchDocs = async () => {
    try {
      const params = new URLSearchParams();
      if (category) params.set("category_id", category);
      if (status) params.set("review_status", status);
      const data = await apiFetch<{ items: Document[]; total: number }>(
        `/documents?${params.toString()}`,
      );
      setDocs(data.items);
      setTotal(data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setInitialLoading(false);
      setFiltering(false);
    }
  };

  const handleFilter = () => {
    setFiltering(true);
    fetchDocs();
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          知识库
        </Title>
        <Link href="/library/upload">
          <Button type="primary" icon={<PlusOutlined />}>
            上传文档
          </Button>
        </Link>
      </div>

      <Card style={{ marginBottom: 16 }}>
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
            loading={filtering}
            onClick={handleFilter}
          >
            应用筛选
          </Button>
        </Space>
      </Card>

      {initialLoading ? (
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
          loading={filtering}
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
