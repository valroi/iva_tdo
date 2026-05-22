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

export const RU_STATUS_LABEL: Record<string, string> = {
  REVISION_CREATED: "Ревизия создана",
  UPLOADED_WAITING_TDO: "Загружено, ожидает ТДО",
  CANCELLED_BY_TDO: "Отклонено руководителем ТДО",
  UNDER_REVIEW: "На рассмотрении заказчиком",
  OWNER_COMMENTS_SENT: "Замечания отправлены подрядчику (CRS)",
  CONTRACTOR_REPLY_I: "Замечания обсуждаются (I)",
  CONTRACTOR_REPLY_A: "Ревизия отработана — требует новой ревизии",
  SUBMITTED: "Документ согласован (AP)",
};

export function getRuStatusLabel(status: string): string {
  return RU_STATUS_LABEL[status] ?? status;
}

export function RevisionStatusCell({
  currentUser,
  status,
}: {
  currentUser: User | null | undefined;
  status: string;
}): JSX.Element {
  const ruLabel = RU_STATUS_LABEL[status] ?? status;

  if (contractorNeedsPdfReupload(currentUser, status)) {
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

  return <Typography.Text>{ruLabel}</Typography.Text>;
}
