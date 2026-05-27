import type { User } from "../types";

/**
 * Матрица действий процесса по ролям и статусам ревизии.
 *
 * Роли:
 *  - Подрядчик (company_type === "contractor"): рук. ТДО подрядчика, разработчик.
 *  - Заказчик (company_type === "owner"): LR, R.
 *  - Администратор (role === "admin"): наблюдатель, без действий процесса —
 *    его инструменты находятся в разделе «Администрирование».
 */

/** Подрядчик — рук. ТДО подрядчика / разработчик. */
export function isContractor(user: User): boolean {
  return user.company_type === "contractor";
}

/** Сторона заказчика — LR / R. */
export function isOwner(user: User): boolean {
  return user.company_type === "owner";
}

/** Администратор — наблюдатель, без кнопок процесса. */
export function isAdminObserver(user: User): boolean {
  return user.role === "admin" || user.company_type === "admin";
}

/**
 * Загрузка / замена основного PDF и доп. файлов ревизии.
 * Только подрядчик и только пока ревизия ещё не ушла на рассмотрение
 * (создана, возвращена руководителем ТДО, либо ожидает проверки ТДО).
 */
export function canUploadRevisionFiles(user: User, revisionStatus?: string | null): boolean {
  if (!isContractor(user) || !user.permissions.can_upload_files) return false;
  const uploadable = ["REVISION_CREATED", "CANCELLED_BY_TDO", "UPLOADED_WAITING_TDO"];
  return revisionStatus == null || uploadable.includes(revisionStatus);
}

/** Создание новой ревизии документа — только подрядчик. */
export function canCreateRevision(user: User): boolean {
  return isContractor(user) && user.permissions.can_upload_files;
}

/**
 * Добавление замечаний к PDF — только заказчик (LR/R) и только пока
 * ревизия находится на рассмотрении заказчиком.
 */
export function canRaiseRemarks(user: User, revisionStatus?: string | null): boolean {
  if (!isOwner(user) || !user.permissions.can_raise_comments) return false;
  return revisionStatus === "UNDER_REVIEW";
}

/** Установка кода рассмотрения (AP) и публикация замечаний в CRS — только LR заказчика. */
export function canPublishToContractor(user: User): boolean {
  return isOwner(user) && user.permissions.can_publish_comments;
}

/**
 * Статусы, в которых заказчик ещё «держит мяч» по ревизии и может
 * выставить AP. В OWNER_COMMENTS_SENT/CONTRACTOR_REPLY_I мяч у подрядчика —
 * никаких действий со стороны заказчика быть не должно.
 */
export function isOwnerActionableStatus(revisionStatus?: string | null): boolean {
  return revisionStatus === "UNDER_REVIEW" || revisionStatus === "CONTRACTOR_REPLY_A";
}

/** Ответ подрядчика на замечания — после получения CRS. */
export function canRespondToRemarks(user: User, revisionStatus?: string | null): boolean {
  if (!isContractor(user)) return false;
  return revisionStatus === "OWNER_COMMENTS_SENT" || revisionStatus === "CONTRACTOR_REPLY_I";
}
