import { useState, useEffect } from "react";
import { Button, List, Badge, Space, Popconfirm, message, Typography } from "antd";
import { FolderOpenOutlined, DeleteOutlined, ReloadOutlined } from "@ant-design/icons";
import { isDesktopMode, getDesktopAPI } from "@/utils/platform";

interface ScanPath {
  id: string;
  path: string;
  status: string;
  file_count: number;
  last_scan_at: string | null;
}

const STATUS_MAP: Record<string, { color: string; text: string }> = {
  idle: { color: "#52c41a", text: "就绪" },
  scanning: { color: "#faad14", text: "扫描中" },
  error: { color: "#ff4d4f", text: "错误" },
};

export default function ScanPathPanel() {
  const [paths, setPaths] = useState<ScanPath[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPaths = async () => {
    // TODO: Fetch from API
    setLoading(false);
  };

  useEffect(() => {
    fetchPaths();
  }, []);

  const handleAddFolder = async () => {
    if (!isDesktopMode()) return;
    const api = getDesktopAPI();
    if (!api) return;

    const folder = await api.pickFolder();
    if (!folder) return;

    // TODO: Call add scan path API
    message.success(`已添加: ${folder}`);
    fetchPaths();
  };

  const handleRemove = async (id: string) => {
    // TODO: Call remove scan path API
    message.success("已移除");
    fetchPaths();
  };

  const handleScan = async (id: string) => {
    // TODO: Trigger scan API
    message.info("开始扫描...");
    fetchPaths();
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>文档扫描路径</Typography.Title>
        <Button icon={<FolderOpenOutlined />} onClick={handleAddFolder}>
          添加文件夹
        </Button>
      </div>

      <List
        loading={loading}
        dataSource={paths}
        locale={{ emptyText: "暂无扫描路径，点击「添加文件夹」开始" }}
        renderItem={(item) => {
          const statusInfo = STATUS_MAP[item.status] || STATUS_MAP.idle;
          return (
            <List.Item
              actions={[
                <Button key="scan" size="small" icon={<ReloadOutlined />} onClick={() => handleScan(item.id)}>
                  扫描
                </Button>,
                <Popconfirm key="del" title="确定移除?" onConfirm={() => handleRemove(item.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Badge color={statusInfo.color} />
                    <span>{item.path}</span>
                  </Space>
                }
                description={`${item.file_count} 个文件 · ${statusInfo.text}${item.last_scan_at ? ` · 上次扫描: ${item.last_scan_at}` : ""}`}
              />
            </List.Item>
          );
        }}
      />
    </div>
  );
}
