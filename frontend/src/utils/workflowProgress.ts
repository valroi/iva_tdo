import type { Revision } from "../types";

export interface ProcessStep {
  title: string;
  description?: string;
}

export const PROCESS_STEPS: ProcessStep[] = [
  { title: "MDR / Разработка", description: "Документ создан в реестре и готовится к выпуску." },
  { title: "Выпуск ревизии", description: "Создана ревизия документа (A/B/00 и т.д.)." },
  { title: "Загрузка PDF и решение ТДО", description: "Подрядчик загружает PDF, ТДО отправляет в TRM или возвращает." },
  { title: "Рассмотрение заказчиком", description: "Заказчик проверяет ревизию и формирует замечания." },
  { title: "Формирование и отправка CRS", description: "LR согласует замечания и отправляет CRS подрядчику." },
  { title: "Ответ подрядчика (A/I)", description: "Подрядчик отвечает: принято (A) или на обсуждении (I)." },
  { title: "Следующая ревизия / завершение", description: "Перевыпуск или финальное закрытие документа." },
];

export function getProcessCurrentStep(status: string | null | undefined): number {
  if (!status) return 0;
  if (status === "REVISION_CREATED") return 1;
  if (status === "UPLOADED_WAITING_TDO" || status === "CANCELLED_BY_TDO") return 2;
  if (status === "UNDER_REVIEW") return 3;
  if (status === "OWNER_COMMENTS_SENT") return 4;
  if (status === "CONTRACTOR_REPLY_I") return 5;
  if (status === "CONTRACTOR_REPLY_A") return 6;
  if (status === "SUBMITTED") return 6;
  return 1;
}

export interface PreviousRevisionRemark {
  id: number;
  revision_id: number;
  revision_code: string;
  status: string;
  review_code: string | null;
  text: string;
  created_at: string;
}

export function shouldCarryRemark(status: string): boolean {
  return status === "OPEN" || status === "IN_PROGRESS" || status === "RESOLVED";
}

export function isOlderRevision(revision: Revision, selected: Revision | null): boolean {
  if (!selected) return false;
  return revision.created_at < selected.created_at;
}

export function isOwnerCommentLockedStatus(status: string | null | undefined): boolean {
  return status === "OWNER_COMMENTS_SENT" || status === "CONTRACTOR_REPLY_I" || status === "CONTRACTOR_REPLY_A";
}

export function isContractorResponseAllowedStatus(status: string | null | undefined): boolean {
  return status === "OWNER_COMMENTS_SENT" || status === "CONTRACTOR_REPLY_I";
}

export function isOwnerCommentingAllowedStatus(status: string | null | undefined): boolean {
  return status === "UNDER_REVIEW" || status === "OWNER_COMMENTS_SENT";
}
