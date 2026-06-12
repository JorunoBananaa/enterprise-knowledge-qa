import type { ReactNode } from "react";
import { Typography } from "antd";

const { Title } = Typography;

interface PageHeaderProps {
  label: string;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

export default function PageHeader({
  label,
  icon,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-[18px]">
      <div>
        <div className="mb-1.5 text-app-muted text-xs font-bold tracking-normal">
          {label}
        </div>
        <Title level={3} className="!mb-1">
          {icon != null && <span className="mr-2 text-zinc-700">{icon}</span>}
          {title}
        </Title>
        {description != null && (
          <p className="!mb-0 text-app-muted text-sm leading-[1.7]">
            {description}
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}
