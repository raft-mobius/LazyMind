import { useState } from "react";
import { Dropdown, Button, Space } from "antd";
import { SwapOutlined, PlusOutlined } from "@ant-design/icons";
import { useDesktopStore } from "@/stores/desktop";
import type { MenuProps } from "antd";

export default function AssistantSwitcher() {
  const { currentAssistant, assistantList, setCurrentAssistant } =
    useDesktopStore();
  const [open, setOpen] = useState(false);

  if (!currentAssistant) return null;

  const items: MenuProps["items"] = [
    ...assistantList.map((assistant) => ({
      key: assistant.id,
      label: (
        <Space>
          <span>{assistant.avatar}</span>
          <span>{assistant.displayName}</span>
        </Space>
      ),
      onClick: () => {
        setCurrentAssistant(assistant.id);
        setOpen(false);
      },
    })),
    { type: "divider" as const },
    {
      key: "create",
      icon: <PlusOutlined />,
      label: "新建助理",
      onClick: () => {
        setOpen(false);
      },
    },
  ];

  return (
    <Dropdown
      menu={{ items, selectedKeys: [currentAssistant.id] }}
      trigger={["click"]}
      open={open}
      onOpenChange={setOpen}
    >
      <Button type="text" size="small" className="assistant-switcher-btn">
        <Space>
          <span>{currentAssistant.avatar}</span>
          <span>{currentAssistant.displayName}</span>
          <SwapOutlined />
        </Space>
      </Button>
    </Dropdown>
  );
}
