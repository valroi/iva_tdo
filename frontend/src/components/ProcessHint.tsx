import { Alert, Button, Space, Typography } from "antd";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import type { CSSProperties } from "react";
import { useState } from "react";

interface Props {
  title: string;
  steps: string[];
  style?: CSSProperties;
}

/**
 * Подсказка по процессу. Свёрнута по умолчанию (показывает только заголовок),
 * чтобы не занимать пол-экрана; разворачивается по клику. Закрытие
 * запоминается в localStorage — опытному пользователю больше не мешает.
 */
export default function ProcessHint({ title, steps, style }: Props): JSX.Element | null {
  const storeKey = `hint_closed_${title}`;
  const [closed, setClosed] = useState(() => localStorage.getItem(storeKey) === "1");
  const [open, setOpen] = useState(false);

  if (closed) return null;

  return (
    <Alert
      type="info"
      showIcon
      style={style}
      closable
      onClose={() => {
        localStorage.setItem(storeKey, "1");
        setClosed(true);
      }}
      message={
        <Space size={6}>
          <Typography.Text strong>{title}</Typography.Text>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            icon={open ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "скрыть" : "как это работает"}
          </Button>
        </Space>
      }
      description={
        open ? (
          <Space direction="vertical" size={2}>
            {steps.map((step, index) => (
              <Typography.Text key={`${index}-${step}`}>{`${index + 1}. ${step}`}</Typography.Text>
            ))}
          </Space>
        ) : undefined
      }
    />
  );
}
