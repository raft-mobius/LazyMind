import { Tooltip, Badge, Space } from "antd";
import { useDesktopStore } from "@/stores/desktop";
import type { ProcessState } from "../../../desktop/src/shared/types";

const STATE_COLORS: Record<ProcessState, string> = {
  healthy: "#52c41a",
  starting: "#faad14",
  pending: "#d9d9d9",
  stopping: "#faad14",
  stopped: "#d9d9d9",
  failed: "#ff4d4f",
};

export default function ServiceStatusBar() {
  const { serviceStatuses } = useDesktopStore();
  const statuses = Object.values(serviceStatuses);

  if (statuses.length === 0) return null;

  const allHealthy = statuses.every((s) => s.state === "healthy");
  const anyFailed = statuses.some((s) => s.state === "failed");
  const aggregateColor = anyFailed
    ? "#ff4d4f"
    : allHealthy
      ? "#52c41a"
      : "#faad14";

  const tooltipContent = (
    <Space direction="vertical" size={2}>
      {statuses.map((s) => (
        <div key={s.name}>
          <Badge color={STATE_COLORS[s.state]} />
          <span style={{ marginLeft: 4 }}>
            {s.name}: {s.state}
          </span>
        </div>
      ))}
    </Space>
  );

  return (
    <Tooltip title={tooltipContent}>
      <Badge color={aggregateColor} style={{ cursor: "pointer" }} />
    </Tooltip>
  );
}
