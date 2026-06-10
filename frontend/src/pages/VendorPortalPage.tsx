import { App, Button, Card, Input, Result, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

import { clearVendorSession, getVendorSession, vendorGetMr, vendorRequestCode, vendorVerifyCode } from "../api";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useI18n } from "../i18n";
import type { MrStatus, VendorMrChecklistItem, VendorMrDocumentView, VendorMrTagView, VendorMrView } from "../types";
import { formatDeadlineRu } from "../utils/datetime";

const MR_STATUS_LABEL: Record<MrStatus, string> = {
  DRAFT: "Черновик",
  OPEN: "Приём заявок открыт",
  CLOSED: "Приём закрыт",
  AWARDED: "Победитель выбран",
};
const SECTION_LABEL: Record<string, { ru: string; en: string }> = {
  BID_INCLUSION: { ru: "Включить в КП", en: "Include in quotation" },
  BID_NOTES: { ru: "Учесть требования", en: "Acknowledge requirements" },
  RFD: { ru: "Документы к предоставлению (RFD)", en: "Documents to provide (RFD)" },
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
  const { t, lang } = useI18n();
  const [step, setStep] = useState<Step>(getVendorSession() ? "portal" : "request");
  const [emailMasked, setEmailMasked] = useState<string>("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [mr, setMr] = useState<VendorMrView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);

  const loadMr = async () => {
    try {
      const data = await vendorGetMr();
      setMr(data);
      setStep("portal");
      setLoadError(null);
      setClosed(false);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      // MR не в статусе приёма — ссылка не открывается.
      if (/not accepting|403/i.test(msg)) {
        clearVendorSession();
        setClosed(true);
        return;
      }
      // Сессия протухла/невалидна — возвращаем к запросу кода.
      clearVendorSession();
      setStep("request");
      setLoadError(msg || "Сессия недоступна");
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
      message.success(t("portal.codeSentTo"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : "";
      if (/not accepting|403/i.test(msg)) { setClosed(true); return; }
      message.error(msg || "Не удалось отправить код");
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
    { title: t("col.tag"), dataIndex: "tag_code", key: "tag_code", width: 160 },
    { title: t("col.name"), dataIndex: "name", key: "name", ellipsis: true },
    { title: t("col.qty"), dataIndex: "quantity", key: "quantity", width: 90, render: (v) => v ?? "—" },
    { title: t("col.unit"), dataIndex: "unit", key: "unit", width: 80, render: (v) => v ?? "—" },
    { title: t("col.note"), dataIndex: "note", key: "note", ellipsis: true, render: (v) => v ?? "—" },
  ];

  const docColumns: ColumnsType<VendorMrDocumentView> = [
    { title: t("col.title"), dataIndex: "title", key: "title", ellipsis: true },
    { title: t("col.file"), dataIndex: "file_name", key: "file_name", ellipsis: true },
    {
      title: t("col.size"),
      dataIndex: "size_bytes",
      key: "size_bytes",
      width: 110,
      render: (v: number | null) => (v ? `${(v / 1024).toFixed(0)} КБ` : "—"),
    },
  ];

  const checklistColumns: ColumnsType<VendorMrChecklistItem> = [
    { title: t("col.code"), dataIndex: "code", key: "code", width: 90, render: (v) => v ?? "—" },
    { title: t("col.requirement"), dataIndex: "title", key: "title", ellipsis: true },
  ];

  const shell = (children: JSX.Element) => (
    <div style={{ minHeight: "100vh", background: "#f5f5f5", padding: "40px 16px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <Space style={{ width: "100%", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <Typography.Title level={3} style={{ marginBottom: 4 }}>{t("portal.title")}</Typography.Title>
            <Typography.Text type="secondary">{t("portal.subtitle")}</Typography.Text>
          </div>
          <LanguageSwitcher size="middle" />
        </Space>
        <div style={{ marginTop: 20 }}>{children}</div>
      </div>
    </div>
  );

  if (closed) {
    return shell(
      <Result status="warning" title={t("portal.noAccess")} />,
    );
  }

  if (step === "request") {
    return shell(
      <Card style={{ maxWidth: 460 }}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text>{t("portal.requestHint")}</Typography.Text>
          {loadError && <Typography.Text type="danger">{loadError}</Typography.Text>}
          <Button type="primary" loading={busy} onClick={handleRequestCode}>{t("portal.getCode")}</Button>
        </Space>
      </Card>,
    );
  }

  if (step === "verify") {
    return shell(
      <Card style={{ maxWidth: 460 }}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Typography.Text>
            {t("portal.codeSentTo")} <b>{emailMasked}</b>. {t("portal.enterCode")}
          </Typography.Text>
          <Input
            placeholder={t("portal.codePlaceholder")}
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onPressEnter={handleVerify}
          />
          <Space>
            <Button type="primary" loading={busy} disabled={code.length !== 6} onClick={handleVerify}>{t("portal.signIn")}</Button>
            <Button onClick={() => setStep("request")}>{t("portal.resend")}</Button>
          </Space>
        </Space>
      </Card>,
    );
  }

  if (!mr) {
    return shell(<Card loading />);
  }

  const checklistBySection = (sec: string) => mr.checklist.filter((c) => c.section === sec);

  return shell(
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        title={`${mr.code} — ${mr.title}`}
        extra={
          <Button size="small" onClick={() => { clearVendorSession(); setStep("request"); setMr(null); }}>
            {t("portal.signOut")}
          </Button>
        }
      >
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Space size={10} wrap>
            <Tag color={mr.is_open ? "processing" : "warning"}>{MR_STATUS_LABEL[mr.status]}</Tag>
            <Typography.Text type="secondary">{t("portal.company")}: {mr.vendor_company_name}</Typography.Text>
            <Typography.Text type="secondary">{t("portal.currency")}: {mr.currency}</Typography.Text>
            <Typography.Text type="secondary">{t("portal.deadline")}: {formatDeadlineRu(mr.deadline_at)}</Typography.Text>
          </Space>
          {mr.description && <Typography.Text>{mr.description}</Typography.Text>}
          {!mr.is_open && <Typography.Text type="danger">{t("portal.closed")}</Typography.Text>}
        </Space>
      </Card>

      <Card title={t("portal.specItems")}>
        <Table rowKey="id" size="small" columns={tagColumns} dataSource={mr.tags} pagination={false} locale={{ emptyText: "—" }} />
      </Card>

      <Card title={t("portal.ownerDocs")}>
        <Table rowKey="id" size="small" columns={docColumns} dataSource={mr.documents} pagination={false} locale={{ emptyText: "—" }} />
      </Card>

      <Card title={t("portal.checklist")}>
        {(["BID_INCLUSION", "BID_NOTES", "RFD"] as const).map((sec) =>
          checklistBySection(sec).length ? (
            <div key={sec} style={{ marginBottom: 12 }}>
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 4 }}>{SECTION_LABEL[sec][lang]}</Typography.Text>
              <Table rowKey="id" size="small" columns={checklistColumns} dataSource={checklistBySection(sec)} pagination={false} />
            </div>
          ) : null,
        )}
      </Card>

      <Result style={{ paddingTop: 8 }} status="info" title={t("portal.soon")} subTitle={t("portal.soonDesc")} />
    </Space>,
  );
}
