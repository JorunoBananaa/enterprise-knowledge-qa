"use client";

import { useState } from "react";
import { List, Button, Card, Space, Typography, Spin, Empty, App } from "antd";
import { CheckOutlined, CloseOutlined, AuditOutlined } from "@ant-design/icons";
import { useApi } from "@/lib/use-api";
import DocumentStatusBadge from "@/components/DocumentStatusBadge";
import PageHeader from "@/components/PageHeader";

const { Text } = Typography;
type ReviewAction = "approve" | "reject";

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
  const [loadingActions, setLoadingActions] = useState<Set<string>>(
    () => new Set(),
  );
  const [completedDocIds, setCompletedDocIds] = useState<Set<number>>(
    () => new Set(),
  );

  const getActionKey = (docId: number, action: ReviewAction) =>
    `${docId}:${action}`;

  const setActionLoading = (
    docId: number,
    action: ReviewAction,
    loading: boolean,
  ) => {
    setLoadingActions((prev) => {
      const next = new Set(prev);
      const key = getActionKey(docId, action);

      if (loading) {
        next.add(key);
      } else {
        next.delete(key);
      }

      return next;
    });
  };

  const isActionLoading = (docId: number, action: ReviewAction) =>
    loadingActions.has(getActionKey(docId, action));

  const { data: docsData, loading: docsLoading } = useApi<{
    items: Document[];
  }>("/documents?review_status=pending_review");
  const docs = docsData?.items ?? [];
  const visibleDocs = docs.filter((doc) => !completedDocIds.has(doc.id));
  const initialLoading = docsLoading && docsData == null;

  const { runAsync: handleApprove } = useApi(
    (id: number) => `/review/documents/${id}/approve`,
    {
      method: "POST",
      manual: true,
    },
  );

  const { runAsync: handleReject } = useApi(
    (id: number) => `/review/documents/${id}/reject`,
    {
      method: "POST",
      manual: true,
    },
  );

  const doApprove = async (id: number) => {
    if (isActionLoading(id, "approve")) return;

    setActionLoading(id, "approve", true);
    try {
      await handleApprove(id);
      setCompletedDocIds((prev) => new Set(prev).add(id));
      message.success("文档已通过审核并完成索引");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "审核通过操作失败");
    } finally {
      setActionLoading(id, "approve", false);
    }
  };

  const doReject = async (id: number) => {
    if (isActionLoading(id, "reject")) return;

    setActionLoading(id, "reject", true);
    try {
      await handleReject(id);
      setCompletedDocIds((prev) => new Set(prev).add(id));
      message.success("文档已驳回");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "驳回操作失败");
    } finally {
      setActionLoading(id, "reject", false);
    }
  };

  return (
    <div className="max-w-[1060px] mx-auto">
      <PageHeader
        label="REVIEW"
        icon={<AuditOutlined />}
        title="审核队列"
        description="审批待审核的文档，通过后自动加入检索索引"
      />

      <Card>
        <Spin spinning={initialLoading}>
          {!initialLoading && visibleDocs.length === 0 ? (
            <Empty description="暂无待审核文档" />
          ) : (
            <List
              dataSource={visibleDocs}
              renderItem={(doc) => (
                <List.Item
                  actions={[
                    <Button
                      type="primary"
                      icon={<CheckOutlined />}
                      loading={
                        isActionLoading(doc.id, "approve") ||
                        doc.index_status === "indexing"
                      }
                      disabled={isActionLoading(doc.id, "reject")}
                      onClick={() => doApprove(doc.id)}
                    >
                      通过
                    </Button>,
                    <Button
                      danger
                      icon={<CloseOutlined />}
                      loading={isActionLoading(doc.id, "reject")}
                      disabled={
                        isActionLoading(doc.id, "approve") ||
                        doc.index_status === "indexing"
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
                        <DocumentStatusBadge status={doc.review_status} />
                        <DocumentStatusBadge status={doc.index_status} />
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
