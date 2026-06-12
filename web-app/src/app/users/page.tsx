"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  App,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  KeyOutlined,
  StopOutlined,
  CheckOutlined,
  TeamOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useRequest } from "ahooks";
import { useApi } from "@/lib/use-api";
import { debounce } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

const { Title } = Typography;

interface UserItem {
  id: number;
  username: string;
  display_name: string;
  role: string;
  status: string;
}

interface UserListResponse {
  items: UserItem[];
  total: number;
}

function roleLabel(role: string) {
  return role === "admin" ? "管理员" : "普通用户";
}

function roleColor(role: string) {
  return role === "admin" ? "purple" : "blue";
}

function statusLabel(status: string) {
  return status === "active" ? "正常" : "已禁用";
}

function statusColor(status: string) {
  return status === "active" ? "green" : "red";
}

export default function UsersPage() {
  const { message } = App.useApp();
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [pagination, setPagination] = useState({ offset: 0, limit: 20 });

  // ── modals ──
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserItem | null>(
    null,
  );

  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [pwdForm] = Form.useForm();

  // ── debounced search ────────────────────────────────────────
  const debouncedSearch = useMemo(
    () =>
      debounce((value: string) => {
        setSubmittedSearch(value);
        setPagination((p) => ({ ...p, offset: 0 }));
      }, 400),
    [],
  );

  const handleSearchChange = (value: string) => {
    setSearch(value);
    debouncedSearch(value);
  };

  // ── fetch users ─────────────────────────────────────────────
  const {
    data: listData = { items: [], total: 0 },
    loading,
    run: fetchUsers,
  } = useApi<UserListResponse>(
    () => {
      const params = new URLSearchParams({
        offset: String(pagination.offset),
        limit: String(pagination.limit),
      });
      if (submittedSearch.trim()) params.set("search", submittedSearch.trim());
      return `/users?${params.toString()}`;
    },
    {
      refreshDeps: [pagination, submittedSearch],
      onError: (err) => {
        message.error(err instanceof Error ? err.message : "加载用户列表失败");
      },
    },
  );

  // ── create ──
  const { loading: creating, run: doCreate } = useApi("/users", {
    method: "POST",
    manual: true,
    onSuccess: () => {
      message.success("用户创建成功");
      setCreateOpen(false);
      createForm.resetFields();
      fetchUsers();
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : "创建失败");
    },
  });

  const handleCreate = (values: Record<string, string>) => {
    doCreate({ ...values, status: "active" });
  };

  // ── edit ──
  const openEdit = (user: UserItem) => {
    setEditUser(user);
    editForm.setFieldsValue({
      display_name: user.display_name,
      role: user.role,
      status: user.status,
    });
  };

  const { loading: updating, run: doUpdate } = useApi(
    (id: number) => `/users/${id}`,
    {
      method: "PATCH",
      manual: true,
      onSuccess: () => {
        message.success("用户信息已更新");
        setEditUser(null);
        editForm.resetFields();
        fetchUsers();
      },
      onError: (err) => {
        message.error(err instanceof Error ? err.message : "更新失败");
      },
    },
  );

  const handleEdit = (values: {
    display_name?: string;
    role?: string;
    status?: string;
  }) => {
    if (!editUser) return;
    doUpdate(editUser.id, values);
  };

  // ── reset password ──
  const openResetPassword = (user: UserItem) => {
    setResetPasswordUser(user);
    pwdForm.resetFields();
  };

  const { loading: resetting, run: doResetPassword } = useApi(
    (id: number) => `/users/${id}/reset-password`,
    {
      method: "POST",
      manual: true,
      onSuccess: () => {
        message.success("密码已重置");
        setResetPasswordUser(null);
        pwdForm.resetFields();
      },
      onError: (err) => {
        message.error(err instanceof Error ? err.message : "密码重置失败");
      },
    },
  );

  const handleResetPassword = (values: { new_password: string }) => {
    if (!resetPasswordUser) return;
    doResetPassword(resetPasswordUser.id, values);
  };

  const submitting = creating || updating || resetting;

  // ── disable toggle ──
  const { run: toggleDisable } = useApi((id: number) => `/users/${id}`, {
    method: "PATCH",
    manual: true,
    onSuccess: (_data, params) => {
      const body = params[1] as { status?: string } | undefined;
      const newStatus = body?.status;
      const actionText = newStatus === "active" ? "启用" : "禁用";
      message.success(`用户已${actionText}`);
      fetchUsers();
    },
    onError: (err) => {
      message.error(err instanceof Error ? err.message : `操作失败`);
    },
  });

  const handleToggleDisable = (user: UserItem) => {
    const newStatus = user.status === "active" ? "disabled" : "active";
    toggleDisable(user.id, { status: newStatus });
  };

  const columns = [
    {
      title: "用户名",
      dataIndex: "username",
      key: "username",
    },
    {
      title: "显示名称",
      dataIndex: "display_name",
      key: "display_name",
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      render: (role: string) => (
        <Tag color={roleColor(role)}>{roleLabel(role)}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (status: string) => (
        <Tag color={statusColor(status)}>{statusLabel(status)}</Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 280,
      render: (_: unknown, record: UserItem) => (
        <Space size={4}>
          <Tooltip title="编辑用户信息与角色">
            <Button
              type="default"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(record)}
            >
              编辑
            </Button>
          </Tooltip>
          <Tooltip title="为该用户重置登录密码">
            <Button
              type="default"
              size="small"
              icon={<KeyOutlined />}
              onClick={() => openResetPassword(record)}
            >
              重置密码
            </Button>
          </Tooltip>
          <Popconfirm
            title={
              record.status === "active"
                ? `确定要禁用用户"${record.display_name}"吗？`
                : `确定要启用用户"${record.display_name}"吗？`
            }
            onConfirm={() => handleToggleDisable(record)}
            okText="确定"
            cancelText="取消"
            okButtonProps={{
              danger: record.status === "active",
            }}
          >
            <Button
              size="small"
              danger={record.status === "active"}
              icon={
                record.status === "active" ? (
                  <StopOutlined />
                ) : (
                  <CheckOutlined />
                )
              }
            >
              {record.status === "active" ? "禁用" : "启用"}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="max-w-[1060px] mx-auto">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">USERS</div>
          <Title level={3} className="!mb-1">
            <TeamOutlined className="mr-2 text-zinc-700" />
            用户管理
          </Title>
          <p className="page-description !mb-0">
            管理系统用户账号、角色权限与状态
          </p>
        </div>
        <Button
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={() => {
            createForm.resetFields();
            setCreateOpen(true);
          }}
        >
          新建用户
        </Button>
      </div>

      <Card className="!mb-4">
        <Space>
          <Input
            placeholder="搜索用户名或显示名称"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{ width: 300 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={() => {
              setSubmittedSearch(search);
              setPagination((p) => ({ ...p, offset: 0 }));
            }}
          >
            搜索
          </Button>
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={listData.items}
        rowKey="id"
        loading={loading}
        pagination={{
          current: Math.floor(pagination.offset / pagination.limit) + 1,
          pageSize: pagination.limit,
          total: listData.total,
          onChange: (page, pageSize) => {
            setPagination({
              offset: (page - 1) * pageSize,
              limit: pageSize,
            });
          },
          showTotal: (t) => `共 ${t} 名用户`,
        }}
      />

      {/* Create Modal */}
      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
        forceRender
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={handleCreate}
          initialValues={{ role: "standard" }}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: "请输入用户名" }]}
          >
            <Input placeholder="字母数字下划线" />
          </Form.Item>
          <Form.Item
            name="display_name"
            label="显示名称"
            rules={[{ required: true, message: "请输入显示名称" }]}
          >
            <Input placeholder="如：张三" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: "请输入密码" },
              { min: 6, message: "密码至少6位" },
            ]}
          >
            <Input.Password placeholder="至少6位" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              options={[
                { label: "管理员", value: "admin" },
                { label: "普通用户", value: "standard" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="编辑用户"
        open={!!editUser}
        onCancel={() => setEditUser(null)}
        onOk={() => editForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
        forceRender
      >
        <Form form={editForm} layout="vertical" onFinish={handleEdit}>
          <Form.Item name="display_name" label="显示名称">
            <Input placeholder="如：张三" />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              options={[
                { label: "管理员", value: "admin" },
                { label: "普通用户", value: "standard" },
              ]}
            />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              options={[
                { label: "正常", value: "active" },
                { label: "已禁用", value: "disabled" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        title={`重置密码 — ${resetPasswordUser?.display_name || ""}`}
        open={!!resetPasswordUser}
        onCancel={() => setResetPasswordUser(null)}
        onOk={() => pwdForm.submit()}
        confirmLoading={submitting}
        destroyOnHidden
        forceRender
      >
        <Form form={pwdForm} layout="vertical" onFinish={handleResetPassword}>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[
              { required: true, message: "请输入新密码" },
              { min: 6, message: "密码至少6位" },
            ]}
          >
            <Input.Password placeholder="至少6位" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
