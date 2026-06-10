import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Лёгкая двуязычность (RU/EN) без внешних зависимостей. Инфраструктура:
 * провайдер + хук useI18n() с t(key). Словари наполняем по мере перевода
 * экранов — недостающий ключ отдаёт сам ключ (видно, что не переведено).
 *
 * Язык хранится в localStorage (tdo_lang), общий для основного приложения
 * и портала подрядчика.
 */

export type Lang = "ru" | "en";

const STORAGE_KEY = "tdo_lang";

type Dict = Record<string, { ru: string; en: string }>;

// Словарь. Ключи — стабильные идентификаторы. Добавляем по ходу.
const DICT: Dict = {
  // Портал подрядчика
  "portal.title": { ru: "Портал поставщика — IvaMaris TDO", en: "Vendor Portal — IvaMaris TDO" },
  "portal.subtitle": { ru: "Заявка на поставку оборудования", en: "Equipment supply requisition" },
  "portal.requestHint": {
    ru: "Для входа подтвердите, что ссылка ваша: мы отправим код на email, указанный заказчиком при приглашении.",
    en: "To sign in, confirm this link is yours: we will email a code to the address provided by the owner.",
  },
  "portal.getCode": { ru: "Получить код на email", en: "Send code to email" },
  "portal.codeSentTo": { ru: "Код отправлен на", en: "Code sent to" },
  "portal.enterCode": { ru: "Введите его для входа.", en: "Enter it to sign in." },
  "portal.codePlaceholder": { ru: "6-значный код", en: "6-digit code" },
  "portal.signIn": { ru: "Войти", en: "Sign in" },
  "portal.resend": { ru: "Отправить код заново", en: "Resend code" },
  "portal.signOut": { ru: "Выйти", en: "Sign out" },
  "portal.closed": { ru: "Приём заявок по этой MR закрыт — изменения недоступны.", en: "Submissions for this MR are closed — changes unavailable." },
  "portal.noAccess": { ru: "Доступ к заявке закрыт. Приём заявок не ведётся.", en: "Access closed. This MR is not accepting submissions." },
  "portal.specItems": { ru: "Позиции спецификации (теги)", en: "Specification items (tags)" },
  "portal.ownerDocs": { ru: "Документы заказчика", en: "Owner documents" },
  "portal.checklist": { ru: "Чек-лист: что предоставить", en: "Checklist: what to provide" },
  "portal.company": { ru: "Компания", en: "Company" },
  "portal.currency": { ru: "Валюта", en: "Currency" },
  "portal.deadline": { ru: "Дедлайн", en: "Deadline" },
  "portal.soon": { ru: "Скоро здесь появится", en: "Coming soon" },
  "portal.soonDesc": {
    ru: "Заполнение цен, загрузка ваших документов и вопросы заказчику — в следующем обновлении.",
    en: "Price entry, your document uploads and questions to the owner — in the next update.",
  },
  "col.tag": { ru: "Тег", en: "Tag" },
  "col.name": { ru: "Наименование", en: "Name" },
  "col.qty": { ru: "Кол-во", en: "Qty" },
  "col.unit": { ru: "Ед.", en: "Unit" },
  "col.note": { ru: "Примечание", en: "Note" },
  "col.title": { ru: "Название", en: "Title" },
  "col.file": { ru: "Файл", en: "File" },
  "col.size": { ru: "Размер", en: "Size" },
  "col.code": { ru: "Код", en: "Code" },
  "col.requirement": { ru: "Требование", en: "Requirement" },
};

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function readLang(): Lang {
  if (typeof window === "undefined") return "ru";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "en" ? "en" : "ru";
}

export function I18nProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [lang, setLangState] = useState<Lang>(readLang());
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, l);
  }, []);
  const t = useCallback(
    (key: string) => {
      const entry = DICT[key];
      if (!entry) return key;
      return entry[lang] ?? key;
    },
    [lang],
  );
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Фолбэк, если хук вызван вне провайдера (например в тестах).
    return { lang: "ru", setLang: () => undefined, t: (k) => DICT[k]?.ru ?? k };
  }
  return ctx;
}
