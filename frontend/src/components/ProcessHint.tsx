import { Alert, Space, Typography } from "antd";
import type { CSSProperties } from "react";

interface Props {
  title: string;
  steps: string[];
  style?: CSSProperties;
}

export default function ProcessHint({ title, steps, style }: Props): JSX.Element {
  return (
    <Alert
      type="info"
      showIcon
      style={style}
      message={title}
      description={
        <Space direction="vertical" size={2}>
          {steps.map((step, index) => (
            <Typography.Text key={`${index}-${step}`}>{`${index + 1}. ${step}`}</Typography.Text>
          ))}
        </Space>
      }
    />
  );
}
