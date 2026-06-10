import { App, Button, Card, Input, Result, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { clearVendorSession, getVendorSession, vendorGetMr, vendorRequestCode, vendorVerifyCode } from "../api";
import type { MrStatus, VendorMrDocumentView, VendorMrTagView, VendorMrView } from "../types";
import { formatDeadlineRu } from "../utils/datetime";

const MR_STATUS_LABEL: Record<MrStatus, string> = {
  DRAFT: "Черновик",
  OPEN: "Приём заявок открыт",
  CLOSED: "Приём закрыт",
  AWARDED: "Победитель выбран",
};

interface Props {
  invitationId: number;
  token: string;
}

type Step = "request" | "verify" | "portal";

/**
 * Гостевой портал подрядчика. Открывается по персональной ссылке
 * #/vendor/<id>?t=<token> ДО логина в систему. Изолирован: видит только
 * свой MR, использует отдельную vendor-сессию (sessionStorage).
 */
export default function VendorPortalPage({ invitationId, token }: Props): JSX.Element {
  const { message } = App.useApp();
  const [step, setStep] = useState<Step>(getVendorSession() ? "portal" : "request");
  const [emailMasked, setEmailMasked] = useState<string>("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [mr, setMr] = useState<VendorMrView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadMr = async () => {
    try {
      const data = await vendorGetMr();
      setMr(data);
      setStep("portal");
      setLoadError(null);
    } catch (error) {
      // Сессия протухла/невалидна — возвращаем к запросу кода.
      clearVendorSession();
      setStep("request");
      setLoadError(error instanceof Error ? error.message : "Сессия недоступна");
    }
  };

  useEffect(() => {
    if (getVendorSession()) {
      void loadMr();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRequestCode = async () => {
    setBusy(true);
    try {
      const res = await vendorRequestCode(invitationId, token);
      setEmailMasked(res.email_masked);
      setStep("verify");
      message.success("Код отправлен на вашу почту");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Не удалось отправить код");
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async () => {
    setBusy(true);
    try {
      await vendorVerifyCode(invitationId, token, code.trim());
      await loadMr();
      message.success("Вход выполнен");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "Неверный код");
    } finally {
      setBusy(false);
    }
  };

  const tagColumns: ColumnsType<VendorMrTagView> = [
    { title: "Тег", dataIndex: "tag_code", key: "tag_code", width: 160 },
    { title: "Наименование", dataIndex: "name", key: "name", ellipsis: true },
    { title: "Кол-во", dataIndex: "quantity", key: "quantity", width: 90, render: (v) => v ?? "—" },
    { title: "Ед.", dataIndex: "unit", key: "unit", width: 80, render: (v) => v ?? "—" },
    { title: "Примечание", dataIndex: "note", key: "note", ellipsis: true, render: (v) => v ?? "—" },
  ];

  const docColumns: ColumnsType<VendorMrDocumentView> = [
    { title: "Название", dataIndex: "title", key: "title", ellipsis: true },
    { title: "Файл", dataIndex: "file_name", key: "file_name", ellipsis: true },
    {
      title: "Размер",
      dataIndex: "size_bytes",
      key: "size_bytes",
      width: 110,
      render: (v: number | null) => (v ? `${(v / 1024).toFixed(0)} КБ` : "—"),
    },
  ];

  const shell = (children: JSX.Element) => (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", padding: "40px 16px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          Портал поставщика — IvaMaris TDO
        </Typography.Title>
        <Typography.Text type="secondary">Заявка на поставку оборудования</Typography.Text>
        <div style={{ marginTop: 20 }}>{children}</div>
      </div>
    </div>
  );

  if (step === "request") {
    return shell(
      <Card style={{ maxWidth: 460 }}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text>
            Для входа подтвердите, что ссылка ваша: мы отправим код на email, указанный заказчиком
            при приглашении.
          </Typography.Text>
          {loadError && <Typography.Text type="danger">{loadError}</Typography.Text>}
          <Button type="primary" loading={busy} onClick={handleRequestCode}>
            Получить код на email
          </Button>
        </Space>
      </Card>,
    );
  }

  if (step === "verify") {
    return shell(
      <Card style={{ maxWidth: 460 }}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text>
            Код отправлен на <b>{emailMasked}</b>. Введите его для входа.
          </Typography.Text>
          <Input
            placeholder="6-значный код"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onPressEnter={handleVerify}
          />
          <Space>
            <Button type="primary" loading={busy} disabled={code.length !== 6} onClick={handleVerify}>
              Войти
            </Button>
            <Button onClick={() => setStep("request")}>Отправить код заново</Button>
          </Space>
        </Space>
      </Card>,
    );
  }

  if (!mr) {
    return shell(<Card loading />);
  }

  return shell(
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title={`${mr.code} — ${mr.title}`}
        extra={
          <Button
            size="small"
            onClick={() => {
              clearVendorSession();
              setStep("request");
              setMr(null);
            }}
          >
            Выйти
          </Button>
        }
      >
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Space size={10} wrap>
            <Tag color={mr.is_open ? "processing" : "warning"}>{MR_STATUS_LABEL[mr.status]}</Tag>
            <Typography.Text type="secondary">Компания: {mr.vendor_company_name}</Typography.Text>
            <Typography.Text type="secondary">Валюта: {mr.currency}</Typography.Text>
            <Typography.Text type="secondary">Дедлайн: {formatDeadlineRu(mr.deadline_at)}</Typography.Text>
          </Space>
          {mr.description && <Typography.Text>{mr.description}</Typography.Text>}
          {!mr.is_open && (
            <Typography.Text type="danger">
              Приём заявок по этой MR закрыт — изменения недоступны.
            </Typography.Text>
          )}
        </Space>
      </Card>

      <Card title="Позиции спецификации (теги)">
        <Table rowKey="id" size="small" columns={tagColumns} dataSource={mr.tags} pagination={false} locale={{ emptyText: "Нет позиций" }} />
        <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          Заполнение цен по позициям появится в ближайшем обновлении портала.
        </Typography.Text>
      </Card>

      <Card title="Документы заказчика">
        <Table rowKey="id" size="small" columns={docColumns} dataSource={mr.documents} pagination={false} locale={{ emptyText: "Нет документов" }} />
      </Card>

      <Result
        style={{ paddingTop: 8 }}
        status="info"
        title="Скоро здесь появится"
        subTitle="Заполнение цен, загрузка ваших документов и вопросы заказчику — в следующем обновлении."
      />
    </Space>,
  );
}
