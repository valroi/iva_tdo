import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useState } from "react";

import { login } from "../api";

interface Props {
  onLoggedIn: () => void;
}

export default function LoginForm({ onLoggedIn }: Props): JSX.Element {
  const [form] = Form.useForm<{ email: string; password: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFinish = async (values: { email: string; password: string }) => {
    setLoading(true);
    setError(null);
    try {
      await login(values.email, values.password);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Card
        style={{
          width: 400,
          boxShadow: "0 4px 24px rgba(0,0,0,0.10)",
          border: "1px solid #e8e8e8",
          borderRadius: 12,
        }}
        styles={{ body: { padding: "28px 28px 24px" } }}
      >
        <div style={{ marginBottom: 24 }}>
          <Typography.Title level={4} style={{ margin: 0, fontSize: 18 }}>
            IvaMaris TDO
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Система управления документами
          </Typography.Text>
        </div>

        {error && (
          <Alert
            type="error"
            message={error}
            style={{ marginBottom: 16, fontSize: 12 }}
            showIcon
          />
        )}

        <Form form={form} layout="vertical" onFinish={handleFinish}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
            <Input placeholder="your@email.com" autoComplete="email" />
          </Form.Item>
          <Form.Item name="password" label="Пароль" rules={[{ required: true }]} style={{ marginBottom: 20 }}>
            <Input.Password placeholder="Пароль" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={loading} style={{ height: 36 }}>
            Войти
          </Button>
        </Form>
      </Card>
    </div>
  );
}
