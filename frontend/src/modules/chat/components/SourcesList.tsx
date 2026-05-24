import { useState } from "react";
import { Collapse, Tag, Typography } from "antd";
import { FileTextOutlined } from "@ant-design/icons";

interface Source {
  doc_id: string;
  chunk_id: string;
  text: string;
  score: number;
  sources: string[];
}

interface SourcesListProps {
  sources: Source[];
}

export default function SourcesList({ sources }: SourcesListProps) {
  if (!sources || sources.length === 0) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <Collapse
        ghost
        size="small"
        items={[{
          key: "sources",
          label: <Typography.Text type="secondary" style={{ fontSize: 12 }}>参考来源 ({sources.length})</Typography.Text>,
          children: (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sources.map((source, idx) => (
                <div key={source.chunk_id} style={{ padding: 8, background: "#f5f5f5", borderRadius: 4, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <Tag icon={<FileTextOutlined />} style={{ fontSize: 11 }}>[{idx + 1}]</Tag>
                    <span style={{ color: "#888" }}>相关度: {(source.score * 100).toFixed(0)}%</span>
                  </div>
                  <Typography.Paragraph
                    ellipsis={{ rows: 2, expandable: true }}
                    style={{ margin: 0, fontSize: 12, color: "#555" }}
                  >
                    {source.text}
                  </Typography.Paragraph>
                </div>
              ))}
            </div>
          ),
        }]}
      />
    </div>
  );
}
