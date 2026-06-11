import { Tag } from "antd";

interface Props {
  status: string;
  type: "review" | "index";
}

const CONFIG: Record<string, { label: string; color: string }> = {
  pending_review: { label: "待审核", color: "gold" },
  approved: { label: "已通过", color: "green" },
  rejected: { label: "已驳回", color: "red" },
  archived: { label: "已归档", color: "default" },
  not_indexed: { label: "未索引", color: "default" },
  indexing: { label: "索引中", color: "blue" },
  indexed: { label: "已索引", color: "green" },
  failed: { label: "失败", color: "red" },
};

export default function DocumentStatusBadge({ status }: Props) {
  const cfg = CONFIG[status] || {
    label: status.replace(/_/g, " "),
    color: "default" as const,
  };
  return <Tag color={cfg.color}>{cfg.label}</Tag>;
}
