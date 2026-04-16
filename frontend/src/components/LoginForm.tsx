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
    <Card style={{ maxWidth: 420, margin: "120px auto" }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        IvaMaris TDO
      </Typography.Title>
      <Typography.Paragraph>Вход по email/паролю.</Typography.Paragraph>

      {error && (
        <Alert
          type="error"
          message="Ошибка входа"
          description={error}
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        onFinish={handleFinish}
      >
        <Form.Item name="email" label="Email" rules={[{ required: true, type: "email" }]}>
          <Input placeholder="admin@ivamaris.io" />
        </Form.Item>
        <Form.Item name="password" label="Пароль" rules={[{ required: true }]}>
          <Input.Password placeholder="Введите пароль" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={loading}>
          Войти
        </Button>
      </Form>
    </Card>
  );
}
