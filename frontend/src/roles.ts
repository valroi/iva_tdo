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
  contractor: {
    code: "contractor",
    labelRu: "Подрядчик",
    labelEn: "Contractor",
    descriptionRu: "Роль подрядчика в проекте.",
    descriptionEn: "Contractor role in project workflow.",
  },
  contractor_manager: {
    code: "contractor_manager",
    labelRu: "Подрядчик",
    labelEn: "Contractor",
    descriptionRu: "Устаревшая роль, отображается как Подрядчик.",
    descriptionEn: "Legacy role, shown as Contractor.",
  },
  contractor_author: {
    code: "contractor_author",
    labelRu: "Подрядчик",
    labelEn: "Contractor",
    descriptionRu: "Устаревшая роль, отображается как Подрядчик.",
    descriptionEn: "Legacy role, shown as Contractor.",
  },
  owner: {
    code: "owner",
    labelRu: "Заказчик",
    labelEn: "Owner",
    descriptionRu: "Роль заказчика в проекте.",
    descriptionEn: "Owner role in project workflow.",
  },
  owner_manager: {
    code: "owner_manager",
    labelRu: "Заказчик",
    labelEn: "Owner",
    descriptionRu: "Устаревшая роль, отображается как Заказчик.",
    descriptionEn: "Legacy role, shown as Owner.",
  },
  owner_reviewer: {
    code: "owner_reviewer",
    labelRu: "Заказчик",
    labelEn: "Owner",
    descriptionRu: "Устаревшая роль, отображается как Заказчик.",
    descriptionEn: "Legacy role, shown as Owner.",
  },
  viewer: {
    code: "viewer",
    labelRu: "Заказчик",
    labelEn: "Owner",
    descriptionRu: "Устаревшая роль, отображается как Заказчик.",
    descriptionEn: "Legacy role, shown as Owner.",
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
