import { Alert, Button, Card, Form, Input, Space, Typography } from "antd";
import { useState } from "react";

import { login } from "../api";

interface Props {
  onLoggedIn: () => void;
}

export default function LoginForm({ onLoggedIn }: Props): JSX.Element {
  const [form] = Form.useForm<{ email: string; password: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeProfile =
    typeof window === "undefined"
      ? "default"
      : new URLSearchParams(window.location.search).get("profile") ?? "default";

  const switchProfile = (profile: string) => {
    if (typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("profile", profile);
    window.location.assign(nextUrl.toString());
  };

  const switchProfileInPlace = (profile: string) => {
    if (typeof window === "undefined") return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("profile", profile);
    window.history.replaceState({}, "", nextUrl.toString());
  };

  const quickProfiles = ["admin", "tdo", "dev", "owner_lr", "owner_rev"];
  const profileCredentials: Record<string, { email: string; password: string }> = {
    admin: { email: "admin@ivamaris.io", password: "admin123" },
    tdo: { email: "tdolead_ctr@mail.ru", password: "Password_123!" },
    dev: { email: "dev_ctr@mail.ru", password: "Password_123!" },
    owner_lr: { email: "owner_lr@mail.ru", password: "Password_123!" },
    owner_rev: { email: "owner_rev@mail.ru", password: "Password_123!" },
  };
  const activeCredentials = profileCredentials[activeProfile];

  const quickLogin = async (profile: string) => {
    const credentials = profileCredentials[profile];
    if (!credentials) return;
    setLoading(true);
    setError(null);
    try {
      switchProfileInPlace(profile);
      await login(credentials.email, credentials.password);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

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
      <Typography.Paragraph>
        Вход по email/паролю.
        <br />
        Демо админ:
        <br />
        admin@ivamaris.io
        <br />
        admin123
      </Typography.Paragraph>
      <Typography.Paragraph style={{ marginBottom: 8 }}>
        Профиль сессии: <b>{activeProfile}</b>
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        {quickProfiles.map((profile) => (
          <Button
            key={profile}
            size="small"
            type={activeProfile === profile ? "primary" : "default"}
            onClick={() => switchProfile(profile)}
          >
            {profile}
          </Button>
        ))}
      </Space>
      <Space wrap style={{ marginBottom: 16 }}>
        {quickProfiles.map((profile) => (
          <Button
            key={`login-${profile}`}
            size="small"
            loading={loading}
            onClick={() => void quickLogin(profile)}
          >
            Войти как {profile}
          </Button>
        ))}
      </Space>

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
        initialValues={{
          email: activeCredentials?.email ?? "",
          password: activeCredentials?.password ?? "",
        }}
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
