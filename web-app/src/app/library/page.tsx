"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Table,
  Button,
  Select,
  Space,
  Card,
  Empty,
  Skeleton,
  Tree,
  Modal,
  Form,
  Input,
  App,
  Dropdown,
  Upload,
  Spin,
  Alert,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DataNode } from "antd/es/tree";
import type { UploadProps } from "antd";
import {
  PlusOutlined,
  SearchOutlined,
  BookOutlined,
  FolderOutlined,
  EditOutlined,
  DeleteOutlined,
  UploadOutlined,
  MoreOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import { useApi } from "@/lib/use-api";
import { getCurrentUser } from "@/lib/auth-client";
import { useRequest } from "ahooks";
import DocumentStatusBadge from "@/components/DocumentStatusBadge";
import PageHeader from "@/components/PageHeader";

// ── types ──

interface Document {
  id: number;
  title: string;
  file_type: string;
  review_status: string;
  index_status: string;
  uploader_id: number;
  category_id: number;
}

interface CategoryItem {
  id: number;
  name: string;
  parent_id: number | null;
  documents_count: number;
}

// ── build category tree for antd Tree ──

interface CatTreeNode extends DataNode {
  categoryId: number;
  parentId: number | null;
  /** raw children before cleaning */
  _children?: CatTreeNode[];
}

function buildCatTree(items: CategoryItem[]): CatTreeNode[] {
  const map = new Map<number, CatTreeNode>();
  const roots: CatTreeNode[] = [];

  for (const item of items) {
    const node: CatTreeNode = {
      key: `cat-${item.id}`,
      title: item.name, // placeholder, overwritten by titleRender
      categoryId: item.id,
      parentId: item.parent_id,
      _children: [],
    };
    map.set(item.id, node);
  }

  for (const node of map.values()) {
    if (node.parentId != null && map.has(node.parentId)) {
      map.get(node.parentId)!._children!.push(node);
    } else {
      roots.push(node);
    }
  }

  // clean empty children and remap to `children`
  const clean = (nodes: CatTreeNode[]) => {
    for (const node of nodes) {
      if (node._children && node._children.length > 0) {
        node.children = node._children;
        clean(node._children);
      }
      delete node._children;
    }
  };
  clean(roots);
  return roots;
}

function parseCategoryParam(value: string | null): number | null {
  if (value == null) return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// ── document table columns ──

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

// ── page ──

export default function LibraryPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-[1160px] mx-auto">
          <PageHeader
            label="KNOWLEDGE BASE"
            icon={<BookOutlined />}
            title="知识库"
            description="分类管理知识文档，上传后经审核即可加入检索索引"
          />
          <div className="flex gap-5 items-start">
            <Card
              className="shrink-0 overflow-hidden"
              styles={{ body: { padding: "12px 8px 8px", overflow: "hidden" } }}
              style={{ width: 260 }}
            >
              <Skeleton active paragraph={{ rows: 4 }} title={false} />
            </Card>
            <div className="flex-1 flex items-center justify-center min-h-[400px]">
              <Skeleton active paragraph={{ rows: 6 }} />
            </div>
          </div>
        </div>
      }
    >
      <LibraryPageContent />
    </Suspense>
  );
}

function LibraryPageContent() {
  const { message, modal } = App.useApp();
  const searchParams = useSearchParams();
  const router = useRouter();
  const categoryParam = searchParams.get("category_id");
  const selectedCategory = parseCategoryParam(categoryParam);
  const [status, setStatus] = useState<string>();

  // ── current user (for admin check) ──
  const { data: user } = useRequest(getCurrentUser);
  const isAdmin = user?.role === "admin";

  // ── fetch documents ──
  const {
    data: docsData,
    loading: docsLoading,
    run: fetchDocs,
  } = useApi<{ items: Document[]; total: number }>(
    () => {
      const params = new URLSearchParams();
      if (selectedCategory != null)
        params.set("category_id", String(selectedCategory));
      if (status) params.set("review_status", status);
      return `/documents?${params.toString()}`;
    },
    { refreshDeps: [selectedCategory, status] },
  );

  // ── delete document ──
  const { loading: deleting, run: doDeleteDoc } = useApi(
    (id: number) => `/documents/${id}`,
    {
      method: "DELETE",
      manual: true,
      onSuccess: () => {
        message.success("文档已删除");
        // 如果删除的是当前列表最后一项且不是第一页，前端保持当前页即可（后端会自动返回前一页数据）
        fetchDocs();
        fetchCategories();
      },
      onError: (err) => {
        message.error(err instanceof Error ? err.message : "删除失败");
      },
    },
  );

  // ── document table columns (with actions) ──
  const tableColumns: ColumnsType<Document> = useMemo(
    () => [
      ...columns,
      {
        title: "操作",
        key: "actions",
        width: 80,
        render: (_: unknown, record: Document) => (
          <Button
            danger
            size="small"
            icon={<DeleteOutlined />}
            loading={deleting}
            onClick={() => {
              modal.confirm({
                title: "确定删除此文档？",
                content: `将同时删除文档「${record.title}」及其全部索引数据，此操作不可撤销。`,
                okText: "确认删除",
                cancelText: "取消",
                okButtonProps: { danger: true },
                onOk: () => doDeleteDoc(record.id),
              });
            }}
          >
            删除
          </Button>
        ),
      },
    ],
    [deleting, modal, doDeleteDoc],
  );

  // 保持上一次数据，避免切换分类时闪烁
  const prevDocsData = useRef(docsData);
  if (docsData) prevDocsData.current = docsData;
  const displayData = docsData ?? prevDocsData.current;
  const docs = displayData?.items ?? [];
  const total = displayData?.total ?? 0;

  // ── fetch categories ──
  const {
    data: catData,
    loading: catLoading,
    run: fetchCategories,
  } = useApi<{ items: CategoryItem[] }>("/categories");

  const categories = catData?.items ?? [];
  const catTree = useMemo(() => buildCatTree(categories), [categories]);
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  // ── category CRUD modal ──
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [creatingParentId, setCreatingParentId] = useState<number | null>(null);
  const [catForm] = Form.useForm();

  const openCreateCat = useCallback((parentId?: number) => {
    setEditingCatId(null);
    setCreatingParentId(parentId ?? null);
    catForm.resetFields();
    setCatModalOpen(true);
  }, [catForm]);

  // ── upload modal ──
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategoryId, setUploadCategoryId] = useState<number | null>(null);
  const [uploadForm] = Form.useForm();

  const openUploadModal = useCallback((categoryId: number) => {
    setUploadFile(null);
    setUploadCategoryId(categoryId);
    uploadForm.resetFields();
    setUploadModalOpen(true);
  }, [uploadForm]);

  const {
    loading: uploading,
    error: uploadError,
    run: doUpload,
  } = useApi("/documents", {
    method: "POST",
    manual: true,
    onSuccess: () => {
      setUploadModalOpen(false);
      message.success("文档上传成功");
      fetchDocs();
      fetchCategories();
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "上传失败");
    },
  });

  const handleUploadSubmit = (values: { title: string }) => {
    if (!uploadFile) {
      message.warning("请选择文件");
      return;
    }
    const formData = new FormData();
    formData.append("title", values.title);
    formData.append("category_id", String(uploadCategoryId));
    formData.append("file", uploadFile);
    doUpload(formData);
  };

  const uploadDraggerProps: UploadProps = {
    maxCount: 1,
    beforeUpload: (file) => {
      setUploadFile(file);
      return false;
    },
    onRemove: () => setUploadFile(null),
    onChange: (info) => {
      if (info.file.name && !uploadForm.getFieldValue("title")) {
        const nameWithoutExt = info.file.name.replace(/\.[^/.]+$/, "");
        uploadForm.setFieldsValue({ title: nameWithoutExt });
      }
    },
    accept: ".pdf,.docx,.pptx,.xlsx",
  };

  const openEditCat = useCallback((record: CategoryItem) => {
    setEditingCatId(record.id);
    catForm.setFieldsValue({ name: record.name });
    setCatModalOpen(true);
  }, [catForm]);

  const onCatSuccess = () => {
    setCatModalOpen(false);
    message.success(editingCatId != null ? "分类已更新" : "分类已创建");
    fetchCategories();
  };
  const onCatError = (err: Error) => {
    message.error(err instanceof Error ? err.message : "操作失败");
  };

  const { loading: creating, run: doCreate } = useApi("/categories", {
    method: "POST",
    manual: true,
    onSuccess: onCatSuccess,
    onError: onCatError,
  });

  const { loading: updating, run: doUpdate } = useApi(
    (id: number) => `/categories/${id}`,
    {
      method: "PATCH",
      manual: true,
      onSuccess: onCatSuccess,
      onError: onCatError,
    },
  );

  const catSubmitting = creating || updating;

  const handleCatSubmit = (values: { name: string }) => {
    if (editingCatId != null) {
      doUpdate(editingCatId, { name: values.name });
    } else {
      doCreate({ name: values.name, parent_id: creatingParentId });
    }
  };

  const { run: doDeleteCat } = useApi((id: number) => `/categories/${id}`, {
    method: "DELETE",
    manual: true,
    onSuccess: (_data, params) => {
      const deletedCategoryId = params[0];
      message.success("分类已删除");
      if (selectedCategory === deletedCategoryId) {
        router.push("/library");
      }
      fetchCategories();
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "删除失败");
    },
  });

  // ── tree node action menu ──
  const getNodeMenuItems = useCallback(
    (node: CatTreeNode) => [
      {
        key: "create-child",
        icon: <PlusOutlined />,
        label: "新建子分类",
        onClick: () => openCreateCat(node.categoryId),
      },
      {
        key: "upload",
        icon: <UploadOutlined />,
        label: "上传文档",
        onClick: () => openUploadModal(node.categoryId),
      },
      {
        key: "edit",
        icon: <EditOutlined />,
        label: "编辑分类",
        onClick: () => {
          const cat = categoryById.get(node.categoryId);
          if (cat) openEditCat(cat);
        },
      },
      { type: "divider" as const },
      {
        key: "delete",
        icon: <DeleteOutlined />,
        label: "删除分类",
        danger: true,
        onClick: () => {
          const cat = categoryById.get(node.categoryId);
          const count = cat?.documents_count ?? 0;

          modal.confirm({
            title: "确定删除此分类？",
            content:
              count > 0
                ? `该分类下共有 ${count} 篇文档，将同时删除所有子分类及其下的全部文档，此操作不可撤销。`
                : "将同时删除所有子分类及其下的全部文档，此操作不可撤销。",
            okText: "确认删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => doDeleteCat(node.categoryId),
          });
        },
      },
    ],
    [
      categoryById,
      doDeleteCat,
      modal,
      openCreateCat,
      openEditCat,
      openUploadModal,
    ],
  );

  // ── tree node title render ──
  const renderTreeTitle = useCallback(
    (node: CatTreeNode) => (
      <div className="flex items-center w-full pr-1 group/tree relative">
        <span className="flex items-center gap-1.5 min-w-0 flex-1 pr-0 group-hover/tree:pr-5 transition-all">
          <FolderOutlined className="text-amber-500 shrink-0" />
          <span className="truncate text-[13px]">{node.title as string}</span>
        </span>
        {isAdmin ? (
          <Dropdown
            menu={{ items: getNodeMenuItems(node) }}
            trigger={["click"]}
            placement="bottomRight"
          >
            <Button
              type="text"
              size="small"
              className="opacity-0 group-hover/tree:opacity-100 transition-opacity duration-200 absolute right-1 top-1/2 -translate-y-1/2"
              icon={<MoreOutlined className="text-[13px]" />}
              onClick={(e) => e.stopPropagation()}
            />
          </Dropdown>
        ) : null}
      </div>
    ),
    [getNodeMenuItems, isAdmin],
  );

  // Attach title render to tree nodes (recursive)
  const attachTitle = useCallback(
    (nodes: CatTreeNode[]): CatTreeNode[] =>
      nodes.map((node) => ({
        ...node,
        title: renderTreeTitle(node),
        children: node.children
          ? attachTitle(node.children as CatTreeNode[])
          : undefined,
      })),
    [renderTreeTitle],
  );

  const renderedTree = useMemo(() => attachTitle(catTree), [
    attachTitle,
    catTree,
  ]);

  // 默认选中第一个根分类
  useEffect(() => {
    if (!catLoading && selectedCategory === null && catTree.length > 0) {
      router.replace(`/library?category_id=${catTree[0].categoryId}`);
    }
  }, [catLoading, selectedCategory, catTree, router]);

  return (
    <div className="max-w-[1160px] mx-auto">
      <PageHeader
        label="KNOWLEDGE BASE"
        icon={<BookOutlined />}
        title="知识库"
        description="分类管理知识文档，上传后经审核即可加入检索索引"
      />

      <div className="flex gap-5 items-start">
        {/* ── left: category tree ── */}
        <Card
          className="shrink-0 overflow-hidden"
          styles={{ body: { padding: "12px 8px 8px", overflow: "hidden" } }}
          style={{ width: 260 }}
        >
          <div className="px-3 mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              文档分类
            </span>
            {isAdmin && (
              <Button
                type="link"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => openCreateCat()}
                className="!text-xs !text-zinc-400 hover:!text-app-primary !px-1"
              >
                新增
              </Button>
            )}
          </div>

          {catLoading ? (
            <div className="px-3">
              <Skeleton active paragraph={{ rows: 4 }} title={false} />
            </div>
          ) : (
            <Tree
              treeData={renderedTree}
              selectedKeys={
                selectedCategory != null ? [`cat-${selectedCategory}`] : []
              }
              onSelect={(keys) => {
                const key = keys[0] as string | undefined;
                if (!key) return; // 不允许取消选中
                if (key.startsWith("cat-")) {
                  const catId = key.slice(4);
                  router.push(`/library?category_id=${catId}`);
                }
              }}
              defaultExpandAll
              blockNode
              showIcon={false}
              className="[&_.ant-tree-node-content-wrapper]:!pr-2 [&_.ant-tree-node-content-wrapper]:!overflow-hidden"
            />
          )}
        </Card>

        {/* ── right: document list ── */}
        {selectedCategory != null ? (
          <div className="flex-1 min-w-0">
            <Card className="!mb-4" styles={{ body: { padding: "12px 16px" } }}>
              <Space wrap>
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
                  loading={docsLoading}
                  onClick={() => fetchDocs()}
                >
                  应用筛选
                </Button>
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  onClick={() => openUploadModal(selectedCategory)}
                >
                  上传文档
                </Button>
              </Space>
            </Card>

            <Table
              columns={tableColumns}
              dataSource={docs}
              rowKey="id"
              loading={docsLoading}
              rowClassName="cursor-pointer transition-colors"
              locale={{
                emptyText: docsLoading ? (
                  " "
                ) : (
                  <Empty description="暂无文档，请上传文档开始使用" />
                ),
              }}
              pagination={{
                total,
                pageSize: 20,
                showTotal: (t) => `共 ${t} 篇文档`,
              }}
            />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center min-h-[400px]">
            <Empty description="请从左侧选择一个分类查看文档" />
          </div>
        )}
      </div>

      {/* ── upload modal ── */}
      <Modal
        title="上传文档"
        open={uploadModalOpen}
        onCancel={() => setUploadModalOpen(false)}
        footer={null}
        destroyOnClose
        width={520}
      >
        <Spin spinning={uploading} tip="正在上传并处理文档...">
          <Form
            form={uploadForm}
            layout="vertical"
            onFinish={handleUploadSubmit}
          >
            <Form.Item
              name="title"
              label="标题"
              rules={[{ required: true, message: "请输入文档标题" }]}
            >
              <Input placeholder="请输入文档标题" />
            </Form.Item>

            <Form.Item label="分类">
              <Input
                disabled
                value={categoryById.get(uploadCategoryId ?? -1)?.name ?? ""}
                className="!text-zinc-700"
              />
            </Form.Item>

            <Form.Item label="文件">
              <Upload.Dragger {...uploadDraggerProps}>
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">
                  支持 PDF、Word、PPT、Excel 格式
                </p>
              </Upload.Dragger>
            </Form.Item>

            {uploadError && (
              <Alert
                message={
                  uploadError instanceof Error
                    ? uploadError.message
                    : "上传失败"
                }
                type="error"
                showIcon
                className="!mb-4"
              />
            )}

            <Form.Item className="!mb-0 text-right">
              <Space>
                <Button onClick={() => setUploadModalOpen(false)}>取消</Button>
                <Button type="primary" htmlType="submit" loading={uploading}>
                  {uploading ? "上传中..." : "上传到知识库"}
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Spin>
      </Modal>

      {/* ── category modal ── */}
      <Modal
        title={editingCatId != null ? "编辑分类" : "新建分类"}
        open={catModalOpen}
        onCancel={() => setCatModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={catForm} layout="vertical" onFinish={handleCatSubmit}>
          <Form.Item
            name="name"
            label="分类名称"
            rules={[{ required: true, message: "请输入分类名称" }]}
          >
            <Input placeholder="例如：产品文档、技术规范" />
          </Form.Item>

          <Form.Item className="!mb-0 text-right">
            <Space>
              <Button onClick={() => setCatModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={catSubmitting}>
                {editingCatId != null ? "保存" : "创建"}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
