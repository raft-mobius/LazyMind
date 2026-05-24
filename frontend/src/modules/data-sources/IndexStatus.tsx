import { useState, useEffect } from "react";
import { Card, Statistic, Row, Col, Progress, Button, List, Tag, Space } from "antd";
import { ReloadOutlined, DatabaseOutlined } from "@ant-design/icons";

interface IndexStats {
  total_segments: number;
  total_vectors: number;
  last_update: string;
}

interface ParseTask {
  id: string;
  file_name: string;
  status: string;
  chunk_count: number;
  error_message: string;
}

export default function IndexStatus() {
  const [stats, setStats] = useState<IndexStats>({ total_segments: 0, total_vectors: 0, last_update: "" });
  const [tasks, setTasks] = useState<ParseTask[]>([]);

  useEffect(() => {
    // TODO: Fetch stats and recent tasks from API
  }, []);

  const statusTag = (status: string) => {
    switch (status) {
      case "completed": return <Tag color="success">完成</Tag>;
      case "processing": return <Tag color="processing">处理中</Tag>;
      case "failed": return <Tag color="error">失败</Tag>;
      default: return <Tag>{status}</Tag>;
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic title="文本分段数" value={stats.total_segments} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="向量数" value={stats.total_vectors} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="最后更新" value={stats.last_update || "—"} />
          </Card>
        </Col>
      </Row>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <h4>解析任务</h4>
        <Button size="small" icon={<ReloadOutlined />}>刷新</Button>
      </div>

      <List
        size="small"
        dataSource={tasks}
        renderItem={(task) => (
          <List.Item>
            <Space>
              {statusTag(task.status)}
              <span>{task.file_name}</span>
              {task.chunk_count > 0 && <span style={{ color: "#888" }}>({task.chunk_count} chunks)</span>}
              {task.error_message && <span style={{ color: "#ff4d4f" }}>{task.error_message}</span>}
            </Space>
          </List.Item>
        )}
      />
    </div>
  );
}
