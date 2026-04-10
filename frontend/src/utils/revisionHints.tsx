import { Space, Tag, Typography } from "antd";
import type { User } from "../types";

/** Разработчик подрядчика: ревизия отклонена ТДО — нужно заново загрузить PDF. */
export function contractorNeedsPdfReupload(
  currentUser: User | null | undefined,
  revisionStatus: string | null | undefined,
): boolean {
  return !!currentUser && currentUser.company_type === "contractor" && revisionStatus === "CANCELLED_BY_TDO";
}

export function ContractorReuploadPdfTag(): JSX.Element {
  return (
    <Tag color="volcano" style={{ marginTop: 2 }}>
      Требуется перезагрузка PDF
    </Tag>
  );
}

export function RevisionStatusCell({
  currentUser,
  status,
}: {
  currentUser: User | null | undefined;
  status: string;
}): JSX.Element {
  const ruLabelMap: Record<string, string> = {
    REVISION_CREATED: "Ревизия создана",
    UPLOADED_WAITING_TDO: "Загружено, ожидает ТДО",
    CANCELLED_BY_TDO: "Отклонено руководителем ТДО",
    UNDER_REVIEW: "На рассмотрении заказчиком",
    OWNER_COMMENTS_SENT: "Замечания отправлены подрядчику",
    CONTRACTOR_REPLY_I: "Замечания обсуждаются",
    CONTRACTOR_REPLY_A: "Ревизия отработана (учесть в новой ревизии)",
    SUBMITTED: "Документ согласован",
  };
  const ruLabel = ruLabelMap[status] ?? status;
  if (status === "CONTRACTOR_REPLY_I") {
    return (
      <Space direction="vertical" size={2}>
        <Typography.Text>{ruLabel}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          CONTRACTOR_REPLY_I
        </Typography.Text>
      </Space>
    );
  }
  if (status === "CONTRACTOR_REPLY_A") {
    return (
      <Space direction="vertical" size={2}>
        <Typography.Text>{ruLabel}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          CONTRACTOR_REPLY_A
        </Typography.Text>
      </Space>
    );
  }
  if (!contractorNeedsPdfReupload(currentUser, status)) {
    return (
      <Space direction="vertical" size={2}>
        <Typography.Text>{ruLabel}</Typography.Text>
        {ruLabel !== status && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {status}
          </Typography.Text>
        )}
      </Space>
    );
  }
  return (
    <Space direction="vertical" size={2}>
      <Typography.Text>{ruLabel}</Typography.Text>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Руководитель ТДО отклонил загрузку. Загрузите исправленный PDF (кнопка «PDF»).
      </Typography.Text>
      <ContractorReuploadPdfTag />
    </Space>
  );
}
