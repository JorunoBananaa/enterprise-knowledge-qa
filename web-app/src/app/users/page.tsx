"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  App,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  KeyOutlined,
  TeamOutlined,
} from "@ant-design/icons";
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
  const { message, modal } = App.useApp();
  const [data, setData] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({ offset: 0, limit: 20 });

  // ── modals ──
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<UserItem | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [pwdForm] = Form.useForm();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        offset: String(pagination.offset),
        limit: String(pagination.limit),
      });
      if (search.trim()) params.set("search", search.trim());
      const res = await apiFetch<UserListResponse>(
        `/users?${params.toString()}`,
      );
      setData(res.items);
      setTotal(res.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载用户列表失败");
    } finally {
      setLoading(false);
    }
  }, [pagination, search, message]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── create ──
  const handleCreate = async (values: {
    username: string;
    display_name: string;
    password: string;
    role: string;
  }) => {
    setSubmitting(true);
    try {
      await apiFetch("/users", {
        method: "POST",
        body: JSON.stringify({ ...values, status: "active" }),
      });
      message.success("用户创建成功");
      setCreateOpen(false);
      createForm.resetFields();
      fetchUsers();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
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

  const handleEdit = async (values: {
    display_name?: string;
    role?: string;
    status?: string;
  }) => {
    if (!editUser) return;
    setSubmitting(true);
    try {
      await apiFetch(`/users/${editUser.id}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      message.success("用户信息已更新");
      setEditUser(null);
      editForm.resetFields();
      fetchUsers();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "更新失败");
    } finally {
      setSubmitting(false);
    }
  };

  // ── reset password ──
  const openResetPassword = (user: UserItem) => {
    setResetPasswordUser(user);
    pwdForm.resetFields();
  };

  const handleResetPassword = async (values: { new_password: string }) => {
    if (!resetPasswordUser) return;
    setSubmitting(true);
    try {
      await apiFetch(`/users/${resetPasswordUser.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify(values),
      });
      message.success("密码已重置");
      setResetPasswordUser(null);
      pwdForm.resetFields();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "密码重置失败");
    } finally {
      setSubmitting(false);
    }
  };

  // ── disable toggle ──
  const toggleDisable = (user: UserItem) => {
    const newStatus = user.status === "active" ? "disabled" : "active";
    const actionText = newStatus === "active" ? "启用" : "禁用";
    modal.confirm({
      title: `确定要${actionText}用户"${user.display_name}"吗？`,
      onOk: async () => {
        try {
          await apiFetch(`/users/${user.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: newStatus }),
          });
          message.success(`用户已${actionText}`);
          fetchUsers();
        } catch (err) {
          message.error(err instanceof Error ? err.message : `操作失败`);
        }
      },
    });
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
      render: (_: unknown, record: UserItem) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            icon={<KeyOutlined />}
            onClick={() => openResetPassword(record)}
          >
            重置密码
          </Button>
          <Button
            type="link"
            danger={record.status === "active"}
            onClick={() => toggleDisable(record)}
          >
            {record.status === "active" ? "禁用" : "启用"}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="max-w-[960px] mx-auto">
      <div className="mb-5">
        <Title level={3} className="!mb-1">
          <TeamOutlined className="mr-2 text-blue-500" />
          用户管理
        </Title>
      </div>

      <Card>
        <div className="flex justify-between mb-4">
          <Input.Search
            placeholder="搜索用户名或显示名称"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPagination({ offset: 0, limit: pagination.limit });
            }}
            onSearch={() => fetchUsers()}
            style={{ width: 300 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              createForm.resetFields();
              setCreateOpen(true);
            }}
          >
            新建用户
          </Button>
        </div>

        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          pagination={{
            current: Math.floor(pagination.offset / pagination.limit) + 1,
            pageSize: pagination.limit,
            total,
            onChange: (page, pageSize) => {
              setPagination({
                offset: (page - 1) * pageSize,
                limit: pageSize,
              });
            },
            showTotal: (t) => `共 ${t} 名用户`,
          }}
        />
      </Card>

      {/* Create Modal */}
      <Modal
        title="新建用户"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => createForm.submit()}
        confirmLoading={submitting}
        destroyOnClose
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
        destroyOnClose
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
        destroyOnClose
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
