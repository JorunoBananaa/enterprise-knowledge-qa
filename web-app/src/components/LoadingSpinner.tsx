import { Spin } from "antd";

interface LoadingSpinnerProps {
  /** Extra classes on the wrapper div. Defaults to py-20. */
  className?: string;
}

/** 居中全幅加载动画 — 替代各处重复的 `<div><Spin /></div>` */
export default function LoadingSpinner({ className }: LoadingSpinnerProps) {
  return (
    <div className={`flex items-center justify-center ${className ?? "py-20"}`}>
      <Spin size="large" />
    </div>
  );
}
