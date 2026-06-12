"use client";

import { useState } from "react";
import { List, Button, Card, Space, Typography, Spin, Empty, App } from "antd";
import { CheckOutlined, CloseOutlined, AuditOutlined } from "@ant-design/icons";
import { useApi } from "@/lib/use-api";
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
  const { message } = App.useApp();
  const [actionLoading, setActionLoading] = useState<{
    docId: number;
    action: "approve" | "reject";
  } | null>(null);

  const {
    data: docsData,
    loading,
    run: fetchDocs,
  } = useApi<{ items: Document[] }>("/documents?review_status=pending_review");
  const docs = docsData?.items;

  const { run: handleApprove } = useApi(
    (id: number) => `/review/documents/${id}/approve`,
    {
      method: "POST",
      manual: true,
      onSuccess: () => {
        message.success("文档已通过审核并完成索引");
        fetchDocs();
      },
      onError: (err) => {
        message.error(err instanceof Error ? err.message : "审核通过操作失败");
      },
      onFinally: () => {
        setActionLoading(null);
      },
    },
  );

  const { run: handleReject } = useApi(
    (id: number) => `/review/documents/${id}/reject`,
    {
      method: "POST",
      manual: true,
      onSuccess: () => {
        message.success("文档已驳回");
        fetchDocs();
      },
      onError: (err) => {
        message.error(err instanceof Error ? err.message : "驳回操作失败");
      },
      onFinally: () => {
        setActionLoading(null);
      },
    },
  );

  const doApprove = (id: number) => {
    setActionLoading({ docId: id, action: "approve" });
    handleApprove(id);
  };

  const doReject = (id: number) => {
    setActionLoading({ docId: id, action: "reject" });
    handleReject(id);
  };

  return (
    <div className="max-w-[1060px] mx-auto">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">REVIEW</div>
          <Title level={3} className="!mb-1">
            <AuditOutlined className="mr-2 text-zinc-700" />
            审核队列
          </Title>
          <p className="page-description !mb-0">
            审批待审核的文档，通过后自动加入检索索引
          </p>
        </div>
      </div>

      <Card>
        <Spin spinning={loading}>
          {!loading && (docs ?? []).length === 0 ? (
            <Empty description="暂无待审核文档" />
          ) : (
            <List
              dataSource={docs ?? []}
              renderItem={(doc) => (
                <List.Item
                  actions={[
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      loading={
                        actionLoading?.docId === doc.id &&
                        actionLoading?.action === "approve"
                      }
                      disabled={
                        actionLoading?.docId === doc.id &&
                        actionLoading?.action === "reject"
                      }
                      onClick={() => doApprove(doc.id)}
                    >
                      通过
                    </Button>,
                    <Button
                      danger
                      icon={<CloseOutlined />}
                      loading={
                        actionLoading?.docId === doc.id &&
                        actionLoading?.action === "reject"
                      }
                      disabled={
                        actionLoading?.docId === doc.id &&
                        actionLoading?.action === "approve"
                      }
                      onClick={() => doReject(doc.id)}
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
                        <Text type="secondary">
                          · 上传者 #{doc.uploader_id}
                        </Text>
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
      </Card>
    </div>
  );
}
