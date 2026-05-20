import { Alert } from "antd";
import { isDesktopMode } from "@/utils/platform";

export default function MockModelWarning() {
  if (!isDesktopMode()) return null;

  return (
    <Alert
      message="当前使用模拟模型响应"
      description="请在设置中配置真实模型 API 以获得完整的对话体验。"
      type="warning"
      showIcon
      closable
      style={{ marginBottom: 12 }}
    />
  );
}
