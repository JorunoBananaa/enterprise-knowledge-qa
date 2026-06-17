import { memo } from "react";
import type { Key } from "react";
import {
  Button,
  Checkbox,
  Drawer,
  Skeleton,
  Space,
  Tag,
  Tree,
} from "antd";
import {
  ClearOutlined,
  FileTextOutlined,
  FilterOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import type { CatTreeNode, DocumentItem } from "../_types";

interface QAScopeDrawerProps {
  open: boolean;
  catTree: CatTreeNode[];
  activeDrawerCatId: number | null;
  activeDrawerCatName: string;
  scopeCategoryIds: number[];
  scopeCategoryKeys: string[];
  scopeDocumentIds: number[];
  scopeDocs: DocumentItem[];
  scopeLabel: string;
  scopeTotal: number;
  onClose: () => void;
  onClearScope: () => void;
  onCategoryIdsChange: (ids: number[]) => void;
  onDocumentIdsChange: (ids: number[]) => void;
  onActiveDrawerCatIdChange: (id: number) => void;
}

const QAScopeDrawer = memo(function QAScopeDrawer({
  open,
  catTree,
  activeDrawerCatId,
  activeDrawerCatName,
  scopeCategoryIds,
  scopeCategoryKeys,
  scopeDocumentIds,
  scopeDocs,
  scopeLabel,
  scopeTotal,
  onClose,
  onClearScope,
  onCategoryIdsChange,
  onDocumentIdsChange,
  onActiveDrawerCatIdChange,
}: QAScopeDrawerProps) {
  return (
    <Drawer
      title={
        <span className="flex items-center gap-2">
          <FilterOutlined className="text-app-primary" />
          <span>选择检索范围</span>
        </span>
      }
      open={open}
      onClose={onClose}
      width={700}
      styles={{
        body: { padding: 0, display: "flex", flexDirection: "column" },
        header: { borderBottom: "1px solid #f0f0f0" },
      }}
      footer={
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-zinc-500 shrink-0">已选范围：</span>
            {scopeTotal === 0 ? (
              <span className="text-xs text-zinc-400">全部知识库</span>
            ) : (
              <span
                className="text-xs text-app-primary font-medium truncate"
                title={scopeLabel}
              >
                {scopeCategoryIds.length > 0 ? (
                  <span>{scopeCategoryIds.length} 个分类</span>
                ) : null}
                {scopeCategoryIds.length > 0 && scopeDocumentIds.length > 0
                  ? "、"
                  : null}
                {scopeDocumentIds.length > 0 ? (
                  <span>{scopeDocumentIds.length} 篇文档</span>
                ) : null}
              </span>
            )}
          </div>
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={onClearScope}
            disabled={scopeTotal === 0}
          >
            清除筛选
          </Button>
        </div>
      }
    >
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[260px] shrink-0 flex flex-col border-r border-app-border-soft bg-zinc-50/50">
          <div className="px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              知识分类
            </span>
            {scopeCategoryIds.length > 0 ? (
              <Tag
                color="blue"
                className="!m-0 !text-[10px] !leading-[16px] !px-[6px]"
              >
                {scopeCategoryIds.length}
              </Tag>
            ) : null}
          </div>
          <div className="flex-1 overflow-auto px-2 pb-3">
            {catTree.length > 0 ? (
              <Tree
                checkable
                checkStrictly={false}
                treeData={catTree}
                checkedKeys={scopeCategoryKeys}
                onCheck={(checked) => {
                  const rawKeys = Array.isArray(checked)
                    ? checked
                    : (checked as { checked: Key[] }).checked;
                  const catIds = rawKeys
                    .filter(
                      (key): key is string =>
                        typeof key === "string" && key.startsWith("cat-"),
                    )
                    .map((key) => Number(key.slice(4)));
                  onCategoryIdsChange(catIds);
                }}
                onSelect={(keys) => {
                  const key = keys[0];
                  if (typeof key === "string" && key.startsWith("cat-")) {
                    onActiveDrawerCatIdChange(Number(key.slice(4)));
                  }
                }}
                titleRender={(node) => {
                  const catNode = node as CatTreeNode;
                  const isSelected = activeDrawerCatId === catNode.categoryId;
                  return (
                    <span
                      className={`flex items-center gap-1.5 text-[13px] ${
                        isSelected ? "text-app-primary font-medium" : ""
                      }`}
                    >
                      <FolderOutlined
                        className={`shrink-0 text-[13px] ${
                          isSelected ? "text-app-primary" : "text-amber-500"
                        }`}
                      />
                      <span className="truncate">{catNode.title as string}</span>
                    </span>
                  );
                }}
                defaultExpandAll
                blockNode
                showIcon={false}
                className="[&_.ant-tree-node-content-wrapper]:!pr-2 [&_.ant-tree-node-content-wrapper]:!overflow-hidden"
              />
            ) : (
              <div className="px-3 pt-2">
                <Skeleton active paragraph={{ rows: 4 }} title={false} />
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          <div className="px-5 py-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              {activeDrawerCatId != null
                ? `文档 · ${activeDrawerCatName}`
                : "文档列表"}
            </span>
            {activeDrawerCatId != null && scopeDocumentIds.length > 0 ? (
              <Tag
                color="blue"
                className="!m-0 !text-[10px] !leading-[16px] !px-[6px]"
              >
                {scopeDocumentIds.length}
              </Tag>
            ) : null}
          </div>
          <div className="flex-1 overflow-auto px-5 pb-4">
            {activeDrawerCatId != null ? (
              scopeDocs.length > 0 ? (
                <Checkbox.Group
                  value={scopeDocumentIds}
                  onChange={(values) =>
                    onDocumentIdsChange(values as number[])
                  }
                  className="w-full"
                >
                  <Space direction="vertical" className="w-full" size={0}>
                    {scopeDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className={`flex items-center gap-2.5 py-2 px-2.5 rounded-md transition-colors -mx-2.5 ${
                          scopeDocumentIds.includes(doc.id)
                            ? "bg-blue-50/60"
                            : "hover:bg-zinc-50"
                        }`}
                      >
                        <Checkbox value={doc.id} className="!mr-0 shrink-0" />
                        <FileTextOutlined className="text-zinc-400 shrink-0 text-[13px]" />
                        <span className="text-[13px] text-zinc-700 truncate">
                          {doc.title}
                        </span>
                      </div>
                    ))}
                  </Space>
                </Checkbox.Group>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <FileTextOutlined className="text-4xl text-zinc-200" />
                  <span className="text-sm text-zinc-400">
                    该分类下暂无文档
                  </span>
                </div>
              )
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <FolderOutlined className="text-4xl text-zinc-200" />
                <span className="text-sm text-zinc-400">
                  请在左侧点击一个分类查看其文档
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Drawer>
  );
});

export default QAScopeDrawer;
