"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Form,
  Input,
  Button,
  Card,
  Tag,
  Typography,
  Modal,
  Select,
  Space,
  Popconfirm,
  Table,
  Tooltip,
  App,
  Statistic,
  Row,
  Col,
  Divider,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  RobotOutlined,
  ApiOutlined,
  StarOutlined,
  KeyOutlined,
  GlobalOutlined,
  WifiOutlined,
  LoadingOutlined,
} from "@ant-design/icons";
import { useApi } from "@/lib/use-api";
import { omit } from "@/lib/utils";
import PageHeader from "@/components/PageHeader";

const { Text } = Typography;
const { TextArea } = Input;

interface LLMConfigItem {
  id: number;
  name: string;
  provider: string;
  model_name: string;
  api_key: string;
  base_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const PROVIDER_OPTIONS = [
  { label: "DeepSeek", value: "deepseek" },
  { label: "OpenAI", value: "openai" },
  { label: "Anthropic (Claude)", value: "anthropic" },
  { label: "智谱 (GLM)", value: "zhipu" },
  { label: "通义千问 (Qwen)", value: "qwen" },
  { label: "Moonshot (Kimi)", value: "moonshot" },
];

const PROVIDER_META: Record<
  string,
  { model: string; baseUrl: string; label: string; color: string }
> = {
  deepseek: {
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com/v1",
    label: "DeepSeek",
    color: "#4F46E5",
  },
  openai: { model: "gpt-4o", baseUrl: "", label: "OpenAI", color: "#10A37F" },
  anthropic: {
    model: "claude-sonnet-4-20250514",
    baseUrl: "",
    label: "Anthropic",
    color: "#D97706",
  },
  zhipu: {
    model: "glm-4-flash",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/",
    label: "智谱",
    color: "#7C3AED",
  },
  qwen: {
    model: "qwen-max",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    label: "通义千问",
    color: "#0891B2",
  },
  moonshot: {
    model: "moonshot-v1-8k",
    baseUrl: "https://api.moonshot.cn/v1",
    label: "Moonshot",
    color: "#2563EB",
  },
};

const PROVIDER_TAG_COLORS: Record<string, string> = {
  deepseek: "blue",
  openai: "green",
  anthropic: "orange",
  zhipu: "purple",
  qwen: "cyan",
  moonshot: "geekblue",
};

/** 新建配置默认值 — 提升到模块作用域避免每次渲染重建 */
const DEFAULT_FORM_VALUES = {
  provider: "deepseek" as string,
  model_name: "deepseek-chat",
  base_url: "https://api.deepseek.com/v1",
};

export default function LLMConfigPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const { message } = App.useApp();

  // ── 获取配置列表 ──
  const {
    data: configs = [],
    loading,
    run: fetchConfigs,
  } = useApi<LLMConfigItem[]>("/llm-configs");

  const activeConfig = useMemo(
    () => configs.find((c) => c.is_active),
    [configs],
  );
  const providerCount = useMemo(
    () => new Set(configs.map((config) => config.provider)).size,
    [configs],
  );

  const openCreate = useCallback(() => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue(DEFAULT_FORM_VALUES);
    setModalOpen(true);
  }, [form]);

  const openEdit = useCallback(
    (record: LLMConfigItem) => {
      setEditingId(record.id);
      form.setFieldsValue({
        name: record.name,
        provider: record.provider,
        model_name: record.model_name,
        api_key: "",
        base_url: record.base_url || "",
      });
      setModalOpen(true);
    },
    [form],
  );

  const handleProviderChange = useCallback(
    (provider: string) => {
      const meta = PROVIDER_META[provider];
      if (meta) {
        form.setFieldsValue({ model_name: meta.model, base_url: meta.baseUrl });
      }
    },
    [form],
  );

  // ── 提交（新建 / 编辑） ──
  const onMutateSuccess = () => {
    setModalOpen(false);
    message.success(editingId != null ? "配置已更新" : "配置已创建");
    fetchConfigs();
  };
  const onMutateError = (err: Error) => {
    message.error(err instanceof Error ? err.message : "操作失败");
  };

  const { loading: creating, run: createConfig } = useApi("/llm-configs", {
    method: "POST",
    manual: true,
    onSuccess: onMutateSuccess,
    onError: onMutateError,
  });

  const { loading: updating, run: updateConfig } = useApi(
    (id: number) => `/llm-configs/${id}`,
    {
      method: "PATCH",
      manual: true,
      onSuccess: onMutateSuccess,
      onError: onMutateError,
    },
  );

  const submitting = creating || updating;

  const handleSubmit = (values: Record<string, string>) => {
    const body: Record<string, string | null> = {
      name: values.name,
      provider: values.provider,
      model_name: values.model_name,
      api_key: values.api_key,
      base_url: values.base_url || null,
    };

    if (editingId != null) {
      const payload = values.api_key ? body : omit(body, "api_key");
      updateConfig(editingId, payload);
    } else {
      createConfig(body);
    }
  };

  // ── 启用配置 ──
  const { run: handleActivate } = useApi(
    (id: number) => `/llm-configs/${id}/activate`,
    {
      method: "POST",
      manual: true,
      onSuccess: () => {
        message.success("已设为默认模型");
        fetchConfigs();
      },
      onError: (err) => {
        message.error(err instanceof Error ? err.message : "设置默认模型失败");
      },
      onFinally: () => {
        setActivatingId(null);
      },
    },
  );

  const doActivate = useCallback(
    (id: number) => {
      setActivatingId(id);
      handleActivate(id);
    },
    [handleActivate],
  );

  // ── 连通性测试 ──
  const { run: runTest } = useApi((id: number) => `/llm-configs/${id}/test`, {
    method: "POST",
    manual: true,
    onSuccess: () => {
      message.success("连通性测试通过");
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "连通性测试失败");
    },
    onFinally: () => {
      setTestingId(null);
    },
  });

  const handleTest = useCallback(
    (id: number) => {
      setTestingId(id);
      runTest(id);
    },
    [runTest],
  );

  // ── 删除配置 ──
  const { run: handleDelete } = useApi((id: number) => `/llm-configs/${id}`, {
    method: "DELETE",
    manual: true,
    onSuccess: () => {
      message.success("配置已删除");
      fetchConfigs();
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "删除失败");
    },
    onFinally: () => {
      setDeletingId(null);
    },
  });

  const doDelete = useCallback(
    (id: number) => {
      setDeletingId(id);
      handleDelete(id);
    },
    [handleDelete],
  );

  const columns = useMemo(
    () => [
      {
        title: "配置名称",
        dataIndex: "name",
        key: "name",
        width: 200,
        ellipsis: true,
        render: (name: string, record: LLMConfigItem) => (
          <Tooltip title={name}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium truncate">{name}</span>
              {record.is_active && (
                <Tag
                  color="success"
                  icon={<CheckCircleOutlined />}
                  className="!m-0 shrink-0"
                >
                  默认
                </Tag>
              )}
            </div>
          </Tooltip>
        ),
      },
      {
        title: "供应商",
        dataIndex: "provider",
        key: "provider",
        width: 120,
        ellipsis: true,
        render: (p: string) => {
          const meta = PROVIDER_META[p];
          return (
            <Tag color={PROVIDER_TAG_COLORS[p] || "default"}>
              {meta ? (
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  {meta.label}
                </span>
              ) : (
                p
              )}
            </Tag>
          );
        },
      },
      {
        title: "模型",
        dataIndex: "model_name",
        key: "model_name",
        width: 180,
        ellipsis: true,
        render: (m: string) => (
          <Text code className="text-xs">
            {m}
          </Text>
        ),
      },
      {
        title: "接口地址",
        dataIndex: "base_url",
        key: "base_url",
        width: 200,
        ellipsis: true,
        render: (url: string | null) =>
          url ? (
            <Tooltip title={url}>
              <Text type="secondary" className="text-xs block truncate">
                {url}
              </Text>
            </Tooltip>
          ) : (
            <Text type="secondary" className="text-xs">
              供应商默认
            </Text>
          ),
      },
      {
        title: "操作",
        key: "actions",
        width: 260,
        render: (_: unknown, record: LLMConfigItem) => {
          const isTesting = testingId === record.id;
          return (
            <Space size={4}>
              <Tooltip title="发送 ping 请求验证 Key 与接口是否可用">
                <Button
                  type="default"
                  size="small"
                  icon={isTesting ? <LoadingOutlined /> : <WifiOutlined />}
                  onClick={() => handleTest(record.id)}
                  loading={isTesting}
                >
                  测试
                </Button>
              </Tooltip>
              {!record.is_active && (
                <Tooltip title="设为默认模型，问答时优先使用">
                  <Button
                    type="default"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    loading={activatingId === record.id}
                    onClick={() => doActivate(record.id)}
                  >
                    设为默认
                  </Button>
                </Tooltip>
              )}
              <Button
                type="default"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEdit(record)}
              >
                编辑
              </Button>
              <Popconfirm
                title="确定删除此配置？"
                description="删除后不可恢复"
                onConfirm={() => doDelete(record.id)}
                okText="确定"
                cancelText="取消"
                okButtonProps={{
                  danger: true,
                  loading: deletingId === record.id,
                }}
              >
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deletingId === record.id}
                >
                  删除
                </Button>
              </Popconfirm>
            </Space>
          );
        },
      },
    ],
    [
      testingId,
      activatingId,
      deletingId,
      doActivate,
      handleTest,
      openEdit,
      doDelete,
    ],
  );

  return (
    <div className="max-w-[1060px] mx-auto space-y-5">
      <PageHeader
        label="LLM CONFIGS"
        icon={<RobotOutlined />}
        title="大模型管理"
        description="管理 DeepSeek、OpenAI 等大模型供应商的 API 配置，支持多配置切换"
        actions={
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            onClick={openCreate}
          >
            添加配置
          </Button>
        }
      />

      {/* ── 统计卡片 ── */}
      <Row gutter={16}>
        <Col xs={12} sm={8}>
          <Card size="small" className="!rounded-xl" style={{ height: "100%" }}>
            <Statistic
              title="配置总数"
              value={configs.length}
              prefix={<ApiOutlined className="!text-blue-500" />}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small" className="!rounded-xl" style={{ height: "100%" }}>
            <Statistic
              title="供应商数"
              value={providerCount}
              prefix={<GlobalOutlined className="!text-green-500" />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card
            size="small"
            className={`!rounded-xl ${activeConfig ? "!border-blue-300 !bg-blue-50/50" : ""}`}
            style={{ height: "100%" }}
          >
            <Statistic
              title="默认模型"
              value={activeConfig?.name ?? "未设置"}
              prefix={
                <StarOutlined
                  className={activeConfig ? "!text-blue-500" : "!text-gray-400"}
                />
              }
              valueStyle={{
                color: activeConfig ? "#1677ff" : "#999",
                fontSize: activeConfig ? 20 : 16,
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── 配置表格 ── */}
      <Table
        dataSource={configs}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        tableLayout="fixed"
        scroll={{ x: 960 }}
        rowClassName={(record) => (record.is_active ? "bg-blue-50/30" : "")}
        locale={{
          emptyText: (
            <div className="py-16 space-y-3">
              <RobotOutlined className="!text-5xl !text-gray-300" />
              <div>
                <Text type="secondary" className="text-base">
                  暂未添加任何大模型配置
                </Text>
              </div>
            </div>
          ),
        }}
      />

      {/* ── 创建 / 编辑弹窗 ── */}
      <Modal
        title={
          <Space>
            <RobotOutlined className="text-blue-500" />
            <span>{editingId ? "编辑大模型配置" : "添加大模型配置"}</span>
          </Space>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
        width={520}
      >
        <Divider className="!my-0 !mb-5" />
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: "请输入配置名称" }]}
          >
            <Input
              prefix={<RobotOutlined className="text-gray-400" />}
              placeholder="例如: DeepSeek 生产环境"
            />
          </Form.Item>

          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="provider"
                label="供应商"
                rules={[{ required: true, message: "请选择供应商" }]}
              >
                <Select
                  options={PROVIDER_OPTIONS}
                  onChange={handleProviderChange}
                  placeholder="选择大模型供应商"
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="model_name"
                label="模型名称"
                rules={[{ required: true, message: "请输入模型名称" }]}
              >
                <Input placeholder="例如: deepseek-chat" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="api_key"
            label={
              <span>
                <KeyOutlined className="mr-1" />
                API Key
              </span>
            }
            rules={[{ required: !editingId, message: "请输入 API Key" }]}
            extra={
              editingId ? "留空则保留原有 Key" : "密钥将加密存储，不会明文展示"
            }
          >
            <TextArea
              rows={2}
              placeholder="sk-..."
              autoComplete="off"
              spellCheck={false}
            />
          </Form.Item>

          <Form.Item
            name="base_url"
            label={
              <span>
                <GlobalOutlined className="mr-1" />
                Base URL
              </span>
            }
            extra="留空则使用供应商默认地址"
          >
            <Input placeholder="例如: https://api.deepseek.com/v1" />
          </Form.Item>

          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              icon={<CheckCircleOutlined />}
            >
              {editingId ? "保存修改" : "创建配置"}
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
