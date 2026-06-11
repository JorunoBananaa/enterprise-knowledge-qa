"use client";

import { useEffect, useState } from "react";
import { List, Button, Space, Typography, Spin, Empty, App } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { apiFetch } from "@/lib/api";
import DocumentStatusBadge from "@/components/DocumentStatusBadge";

const { Title, Text } = Typography;

interface Document {
  id: number;
  title: string;
  file_type: string;
  review_status: string;
  index_status: string;
  uploader_id: number;
}

export default function ReviewPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const { message } = App.useApp();

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: Document[] }>(
        "/documents?review_status=pending_review",
      );
      setDocs(data.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const handleApprove = async (id: number) => {
    try {
      await apiFetch(`/review/documents/${id}/approve`, { method: "POST" });
      message.success("文档已通过审核并完成索引");
      fetchDocs();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "审核通过操作失败");
    }
  };

  const handleReject = async (id: number) => {
    try {
      await apiFetch(`/review/documents/${id}/reject`, { method: "POST" });
      message.success("文档已驳回");
      fetchDocs();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "驳回操作失败");
    }
  };

  return (
    <div>
      <Title level={3}>审核队列</Title>

      <Spin spinning={loading}>
        {!loading && docs.length === 0 ? (
          <Empty description="暂无待审核文档" />
        ) : (
          <List
            dataSource={docs}
            renderItem={(doc) => (
              <List.Item
                actions={[
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={() => handleApprove(doc.id)}
                  >
                    通过
                  </Button>,
                  <Button
                    danger
                    icon={<CloseOutlined />}
                    onClick={() => handleReject(doc.id)}
                  >
                    驳回
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={doc.title}
                  description={
                    <Space>
                      <Text type="secondary">{doc.file_type}</Text>
                      <Text type="secondary">· 上传者 #{doc.uploader_id}</Text>
                      <DocumentStatusBadge
                        status={doc.review_status}
                        type="review"
                      />
                      <DocumentStatusBadge
                        status={doc.index_status}
                        type="index"
                      />
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Spin>
    </div>
  );
}
