import type { UserRole } from "./types";

export interface RoleMeta {
  code: UserRole;
  labelRu: string;
  labelEn: string;
  descriptionRu: string;
  descriptionEn: string;
}

export const ROLE_META: Record<UserRole, RoleMeta> = {
  admin: {
    code: "admin",
    labelRu: "Администратор",
    labelEn: "Administrator",
    descriptionRu: "Системный администратор. Права определяются главным админом.",
    descriptionEn: "System administrator. Permissions are assigned by the main admin.",
  },
  owner_manager: {
    code: "owner_manager",
    labelRu: "Менеджер заказчика",
    labelEn: "Owner manager",
    descriptionRu: "Координирует проверку и согласование документов со стороны заказчика.",
    descriptionEn: "Coordinates document review and approvals on the owner side.",
  },
  owner_reviewer: {
    code: "owner_reviewer",
    labelRu: "Ревьюер заказчика",
    labelEn: "Owner reviewer",
    descriptionRu: "Проверяет документы и оставляет замечания.",
    descriptionEn: "Reviews documents and creates comments.",
  },
  contractor_manager: {
    code: "contractor_manager",
    labelRu: "Менеджер подрядчика",
    labelEn: "Contractor manager",
    descriptionRu: "Управляет подготовкой документации и работой авторов подрядчика.",
    descriptionEn: "Manages contractor documentation preparation and author activities.",
  },
  contractor_author: {
    code: "contractor_author",
    labelRu: "Автор подрядчика",
    labelEn: "Contractor author",
    descriptionRu: "Готовит документы и отвечает на замечания.",
    descriptionEn: "Prepares documents and responds to comments.",
  },
  viewer: {
    code: "viewer",
    labelRu: "Наблюдатель",
    labelEn: "Viewer",
    descriptionRu: "Доступ только на просмотр без редактирования.",
    descriptionEn: "Read-only access without editing.",
  },
};

export function roleDisplayRuEn(role: UserRole): string {
  const meta = ROLE_META[role];
  return `${meta.labelRu} / ${meta.labelEn}`;
}

export function roleTooltipRuEn(role: UserRole): string {
  const meta = ROLE_META[role];
  return `${meta.code}\n${meta.labelRu} / ${meta.labelEn}\n${meta.descriptionRu}\n${meta.descriptionEn}`;
}
