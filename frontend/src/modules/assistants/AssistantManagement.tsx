import { useState, useEffect } from "react";
import { Button, Card, Space, Empty, Modal, Input, Form, message } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useDesktopStore } from "@/stores/desktop";
import type { AssistantInfo } from "../../../desktop/src/shared/types";

const EMOJI_OPTIONS = ["🪐", "🌟", "🔬", "📚", "🎨", "🎵", "🧠", "💡", "🌍", "🚀", "🔭", "🌸"];

export default function AssistantManagement() {
  const { assistantList, refreshAssistantList, currentAssistant } = useDesktopStore();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    refreshAssistantList();
  }, []);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      // TODO: Call create assistant API
      message.success("助理创建成功");
      setCreateModalOpen(false);
      form.resetFields();
      refreshAssistantList();
    } catch {
      // validation failed
    }
  };

  const handleDelete = (assistant: AssistantInfo) => {
    Modal.confirm({
      title: "删除助理",
      content: `确定要删除「${assistant.displayName}」吗？该操作将删除该助理的所有数据。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: async () => {
        // TODO: Call delete assistant API
        message.success("已删除");
        refreshAssistantList();
      },
    });
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>AI 助理管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
          新建助理
        </Button>
      </div>

      {assistantList.length === 0 ? (
        <Empty description="暂无助理" />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {assistantList.map((assistant) => (
            <Card
              key={assistant.id}
              hoverable
              style={{ border: currentAssistant?.id === assistant.id ? "2px solid #1677ff" : undefined }}
              actions={[
                <EditOutlined key="edit" />,
                <DeleteOutlined key="delete" onClick={() => handleDelete(assistant)} />,
              ]}
            >
              <Card.Meta
                avatar={<span style={{ fontSize: 32 }}>{assistant.avatar}</span>}
                title={assistant.displayName}
                description={assistant.description}
              />
            </Card>
          ))}
        </div>
      )}

      <Modal
        title="新建助理"
        open={createModalOpen}
        onOk={handleCreate}
        onCancel={() => setCreateModalOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true, pattern: /^[a-z0-9_]+$/, message: "只允许小写字母、数字和下划线" }]}>
            <Input placeholder="如: researcher" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称" rules={[{ required: true }]}>
            <Input placeholder="如: 研究员" />
          </Form.Item>
          <Form.Item name="avatar" label="头像" initialValue="🪐">
            <Space wrap>
              {EMOJI_OPTIONS.map((emoji) => (
                <Button key={emoji} onClick={() => form.setFieldValue("avatar", emoji)}>
                  {emoji}
                </Button>
              ))}
            </Space>
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="描述该助理的专长和用途" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
