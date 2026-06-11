"use client";

import { Card, Tag, Typography, Space } from "antd";
import { UserOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

export default function UsersPage() {
  return (
    <div>
      <Title level={3}>用户管理</Title>
      <Card>
        <Text type="secondary">用户管理功能即将上线。</Text>
        <div
          style={{
            marginTop: 16,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <Card size="small">
            <Space>
              <UserOutlined />
              <Text strong>admin</Text>
              <Tag color="purple">管理员</Tag>
            </Space>
          </Card>
          <Card size="small">
            <Space>
              <UserOutlined />
              <Text strong>user</Text>
              <Tag color="blue">普通用户</Tag>
            </Space>
          </Card>
        </div>
      </Card>
    </div>
  );
}
