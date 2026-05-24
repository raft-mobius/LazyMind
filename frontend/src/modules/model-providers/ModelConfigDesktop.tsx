import { useState, useEffect } from "react";
import { Button, Card, Form, Input, Select, Space, Alert, message, Tag } from "antd";
import { PlusOutlined, CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { isDesktopMode, getDesktopAPI } from "@/utils/platform";

interface ModelConfig {
  id: string;
  provider: string;
  model_name: string;
  api_key_masked: string;
  status: "connected" | "failed" | "untested";
}

const PROVIDERS = [
  { value: "dashscope", label: "DashScope (通义千问)" },
  { value: "openai", label: "OpenAI" },
  { value: "local", label: "本地模型" },
];

export default function ModelConfigDesktop() {
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form] = Form.useForm();
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    // TODO: Load model configs from API
  }, []);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const api = getDesktopAPI();
      if (api) {
        await api.setCredential("model", `${values.provider}_${values.id || "default"}`, values.api_key);
      }
      message.success("模型配置已保存");
      setShowAdd(false);
      form.resetFields();
    } catch {
      // validation failed
    }
  };

  const handleTest = async (configId: string) => {
    setTesting(configId);
    // TODO: Call test connection API
    setTimeout(() => {
      setTesting(null);
      message.success("连接成功");
    }, 1000);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "connected": return <Tag icon={<CheckCircleOutlined />} color="success">已连接</Tag>;
      case "failed": return <Tag icon={<CloseCircleOutlined />} color="error">连接失败</Tag>;
      default: return <Tag>未测试</Tag>;
    }
  };

  if (!isDesktopMode()) return null;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>模型配置</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowAdd(true)}>
          添加模型
        </Button>
      </div>

      {configs.length === 0 && !showAdd && (
        <Alert
          type="warning"
          showIcon
          message="尚未配置模型"
          description="请添加至少一个模型提供商的 API Key 以开始使用 AI 功能。"
          action={
            <Button size="small" type="primary" onClick={() => setShowAdd(true)}>
              立即配置
            </Button>
          }
        />
      )}

      {showAdd && (
        <Card title="添加模型配置" style={{ marginBottom: 16 }}>
          <Form form={form} layout="vertical">
            <Form.Item name="provider" label="提供商" rules={[{ required: true }]}>
              <Select options={PROVIDERS} placeholder="选择模型提供商" />
            </Form.Item>
            <Form.Item name="model_name" label="模型名称">
              <Input placeholder="如: qwen-plus, gpt-4o" />
            </Form.Item>
            <Form.Item name="api_key" label="API Key" rules={[{ required: true }]}>
              <Input.Password placeholder="sk-..." />
            </Form.Item>
            <Form.Item name="endpoint" label="自定义 Endpoint (可选)">
              <Input placeholder="https://..." />
            </Form.Item>
            <Space>
              <Button type="primary" onClick={handleSave}>保存</Button>
              <Button onClick={() => { setShowAdd(false); form.resetFields(); }}>取消</Button>
            </Space>
          </Form>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {configs.map((config) => (
          <Card key={config.id}>
            <Card.Meta
              title={<Space>{config.provider} {statusIcon(config.status)}</Space>}
              description={
                <div>
                  <div>模型: {config.model_name}</div>
                  <div>Key: {config.api_key_masked}</div>
                </div>
              }
            />
            <div style={{ marginTop: 12 }}>
              <Button size="small" loading={testing === config.id} onClick={() => handleTest(config.id)}>
                测试连接
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
