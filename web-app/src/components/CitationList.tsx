import { Card, Typography, theme } from "antd";
import { FileTextOutlined } from "@ant-design/icons";

const { Text, Paragraph } = Typography;

interface Citation {
  document_id: number;
  chunk_id: number;
  locator: string;
  quoted_text_preview?: string | null;
}

interface Props {
  citations: Citation[];
}

export default function CitationList({ citations }: Props) {
  const { token } = theme.useToken();

  if (citations.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <Text strong style={{ fontSize: 13, color: token.colorTextSecondary }}>
        📎 引用来源
      </Text>
      {citations.map((c, i) => (
        <Card
          key={i}
          size="small"
          styles={{ body: { padding: "10px 14px" } }}
          style={{
            marginTop: 8,
            borderRadius: token.borderRadius,
            borderColor: token.colorBorderSecondary,
            background: token.colorBgContainer,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <FileTextOutlined
              style={{ color: token.colorPrimary, fontSize: 13 }}
            />
            <Text strong style={{ fontSize: 13 }}>
              文档 #{c.document_id}
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              — {c.locator}
            </Text>
          </div>
          {c.quoted_text_preview && (
            <Paragraph
              type="secondary"
              italic
              style={{
                marginTop: 8,
                marginBottom: 0,
                fontSize: 13,
                padding: "8px 12px",
                background: token.colorFillSecondary,
                borderRadius: token.borderRadiusSM,
                borderLeft: `3px solid ${token.colorPrimaryBorder}`,
              }}
            >
              &ldquo;{c.quoted_text_preview}&rdquo;
            </Paragraph>
          )}
        </Card>
      ))}
    </div>
  );
}
