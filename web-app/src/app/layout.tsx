import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import "./globals.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "知识库问答系统",
  description: "知识库智能问答平台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <AntdRegistry>
          <ConfigProvider
            locale={zhCN}
            theme={{
              token: {
                colorPrimary: "#171717",
                colorBgBase: "#f8fafc",
                colorBgLayout: "#f8fafc",
                colorBgContainer: "#ffffff",
                colorBorder: "#e5e7eb",
                colorBorderSecondary: "#eef2f7",
                colorText: "#1f2937",
                colorTextSecondary: "#64748b",
                colorTextTertiary: "#94a3b8",
                borderRadius: 8,
                borderRadiusLG: 8,
                controlHeight: 36,
                fontSize: 14,
                controlItemBgActive: "#f4f4f5",
                controlItemBgHover: "#f8fafc",
              },
              components: {
                Table: {
                  rowHoverBg: "#f4f6f9",
                },
              },
            }}
          >
            <AppShell>{children}</AppShell>
          </ConfigProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
