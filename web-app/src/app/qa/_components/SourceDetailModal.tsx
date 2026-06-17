import { memo } from "react";
import { Modal, Typography } from "antd";
import {
  FileTextOutlined,
  FolderOpenOutlined,
  NumberOutlined,
} from "@ant-design/icons";
import Link from "next/link";
import type { SourceSummary } from "../_types";

const { Text, Paragraph } = Typography;

interface SourceDetailModalProps {
  sourceDetail: SourceSummary | null;
  onClose: () => void;
}

const SourceDetailModal = memo(function SourceDetailModal({
  sourceDetail,
  onClose,
}: SourceDetailModalProps) {
  const citationCount = sourceDetail?.citations.length ?? 0;

  return (
    <Modal
      title={
        <div className="flex min-w-0 items-center gap-2">
          <FileTextOutlined className="shrink-0 text-app-primary" />
          <span className="min-w-0 truncate">来源详情</span>
          {citationCount > 0 ? (
            <span className="ml-1 shrink-0 rounded-full bg-app-primary-soft px-2 py-0.5 text-xs font-medium text-app-muted">
              {citationCount} 个片段
            </span>
          ) : null}
        </div>
      }
      open={sourceDetail != null}
      onCancel={onClose}
      footer={null}
      width={720}
      styles={{
        body: {
          paddingTop: 10,
        },
      }}
    >
      {sourceDetail && (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-lg border border-app-border bg-white shadow-app">
            <div className="border-b border-app-border-soft bg-app-surface-muted px-4 py-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <Text
                    className="block !text-base !font-semibold !leading-6 !text-app-text"
                    ellipsis={{ tooltip: sourceDetail.name }}
                  >
                    {sourceDetail.name}
                  </Text>
                </div>
                {sourceDetail.fileType ? (
                  <span className="shrink-0 rounded-md border border-app-border-soft bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wide text-app-text">
                    {sourceDetail.fileType}
                  </span>
                ) : null}
              </div>
            </div>

            {sourceDetail.document_path ? (
              <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[88px_1fr]">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-app-muted">
                  <FolderOpenOutlined className="text-[13px]" />
                  目录路径
                </span>
                <Link
                  href={`/library?category_id=${sourceDetail.categoryId}`}
                  rel="noopener noreferrer"
                  className="min-w-0 break-words rounded-md bg-app-accent px-2.5 py-1.5 text-app-primary"
                >
                  {sourceDetail.document_path}
                </Link>
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-app-muted">
                引用片段
              </span>
              <span className="text-xs text-zinc-400">{citationCount} 条</span>
            </div>
            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-1">
              {sourceDetail.citations.map((citation, index) => {
                const preview = citation.quoted_text_preview?.trim();
                return (
                  <article
                    key={citation.id ?? `${citation.chunk_id}-${index}`}
                    className="rounded-md border border-app-border-soft bg-white px-3.5 py-3 transition-colors hover:border-zinc-300 hover:bg-zinc-50/60"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-app-primary-soft px-2 text-xs font-medium text-app-text">
                        <NumberOutlined className="text-[11px]" />
                        {index + 1}
                      </span>
                    </div>
                    {preview ? (
                      <Paragraph
                        className="!mb-0 !mt-2.5 !text-[13px] !leading-6 !text-zinc-700"
                        ellipsis={{
                          rows: 4,
                          expandable: true,
                          symbol: "展开",
                        }}
                      >
                        {preview}
                      </Paragraph>
                    ) : (
                      <div className="mt-2.5 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-400">
                        暂无片段预览
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
});

export default SourceDetailModal;
