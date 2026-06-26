"use client";

import { useMemo } from "react";
import { Tabs } from "antd";
import { SettingOutlined, FileTextOutlined } from "@ant-design/icons";
import { useRequest } from "ahooks";
import { getCurrentUser } from "@/lib/auth-client";
import PageHeader from "@/components/PageHeader";
import LoadingSpinner from "@/components/LoadingSpinner";
import PromptPanel from "@/components/PromptPanel";

// ── 统一提示词页面 ─────────────────────────────────────────────────

export default function PromptsPage() {
  const { data: user = null, loading } = useRequest(getCurrentUser, {
    onError: () => {
      // AppShell 负责全局的未认证重定向。
    },
  });
  const isAdmin = user?.role === "admin";
  const tabItems = useMemo(() => {
    const personalTab = {
      key: "personal",
      label: (
        <span className="flex items-center gap-1.5">
          <FileTextOutlined />
          个人提示词
        </span>
      ),
      children: (
        <PromptPanel
          endpoint="/prompts/me"
          description="自定义回答的风格和格式，仅对你本人可见。"
          placeholder="自定义回答的风格和格式，可为空..."
        />
      ),
    };

    if (!isAdmin) return [personalTab];

    return [
      {
        key: "system",
        label: (
          <span className="flex items-center gap-1.5">
            <SettingOutlined />
            系统提示词
          </span>
        ),
        children: (
          <PromptPanel
            endpoint="/prompts/system"
            description="系统提示词定义了回答的基础规则，对所有问答生效。"
            placeholder="请输入系统提示词内容，可为空..."
          />
        ),
      },
      personalTab,
    ];
  }, [isAdmin]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="w-full max-w-[1060px] mx-auto">
      <PageHeader
        label="PROMPTS"
        icon={<FileTextOutlined />}
        title="提示词管理"
        description={
          isAdmin
            ? "管理系统全局提示词与个人自定义提示词"
            : "自定义问答风格，让你的回答更符合个人偏好"
        }
      />

      <Tabs
        className="[&_.ant-tabs-nav]:!mb-4 [&_.ant-tabs-tab]:!py-[9px] [&_.ant-tabs-tab]:!px-[13px]"
        defaultActiveKey={isAdmin ? "system" : "personal"}
        items={tabItems}
        size="large"
      />
    </div>
  );
}
