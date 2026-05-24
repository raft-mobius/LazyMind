import { Alert, Button, Space } from "antd";
import { WarningOutlined, RedoOutlined } from "@ant-design/icons";

interface InterruptedMessageProps {
  onRetry: () => void;
}

export default function InterruptedMessage({ onRetry }: InterruptedMessageProps) {
  return (
    <Alert
      type="warning"
      icon={<WarningOutlined />}
      message="该对话因应用重启中断"
      description="上次对话在应用关闭时未完成，您可以重试该问题。"
      action={
        <Button size="small" icon={<RedoOutlined />} onClick={onRetry}>
          重试
        </Button>
      }
      style={{ marginBottom: 8 }}
    />
  );
}
