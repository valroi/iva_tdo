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
  "col.price": { ru: "Цена", en: "Price" },
  "col.answer": { ru: "Ответ", en: "Answer" },
  "col.attach": { ru: "Документ", en: "Document" },
  "ans.yes": { ru: "Да", en: "Yes" },
  "ans.no": { ru: "Нет", en: "No" },
  "ans.na": { ru: "Н/П", en: "N/A" },
  "portal.priceHint": { ru: "Укажите цену по каждой позиции и сохраните.", en: "Enter a price for each item and save." },
  "portal.saved": { ru: "Сохранено", en: "Saved" },
  "portal.upload": { ru: "Загрузить", en: "Upload" },
  "portal.notePlaceholder": { ru: "Примечание", en: "Note" },
  "portal.questions": { ru: "Вопросы заказчику", en: "Questions to the owner" },
  "portal.askPlaceholder": { ru: "Ваш вопрос заказчику…", en: "Your question to the owner…" },
  "portal.ask": { ru: "Задать вопрос", en: "Ask" },
  "portal.noQuestions": { ru: "Вопросов пока нет.", en: "No questions yet." },
  "portal.public": { ru: "Публичный", en: "Public" },
  "portal.answer": { ru: "Ответ", en: "Answer" },

  // Страница «Закупки» (заказчик)
  "vend.title": { ru: "Вендоры — заявки на поставку (MR)", en: "Vendors — Material Requisitions (MR)" },
  "vend.import": { ru: "Импорт REQ (.docx)", en: "Import REQ (.docx)" },
  "vend.createMr": { ru: "+ Создать MR", en: "+ New MR" },
  "vend.hintTitle": { ru: "Как работать с модулем Вендоры", en: "How to use the Vendors module" },
  "vend.hint1": { ru: "Импортируйте REQ (.docx) — структура MR (теги, чек-листы) создастся автоматически.", en: "Import a REQ (.docx) — the MR structure (tags, checklists) is created automatically." },
  "vend.hint2": { ru: "Догрузите документы заказчика по чек-листу, при необходимости поправьте пункты.", en: "Upload owner documents per the checklist; adjust items if needed." },
  "vend.hint3": { ru: "Пригласите подрядчиков (до 5) — каждому уйдёт персональная ссылка.", en: "Invite vendors (up to 5) — each receives a personal link." },
  "vend.emptyMr": { ru: "Нет MR. Импортируйте REQ или создайте вручную.", en: "No MR. Import a REQ or create manually." },
  "vend.col.code": { ru: "Код MR", en: "MR code" },
  "vend.col.equip": { ru: "Оборудование", en: "Equipment" },
  "vend.col.disc": { ru: "Дисц.", en: "Disc." },
  "vend.col.status": { ru: "Статус", en: "Status" },
  "vend.col.tags": { ru: "Теги", en: "Tags" },
  "vend.col.owner": { ru: "Заказчик", en: "Owner" },
  "vend.col.vendor": { ru: "Подрядчик", en: "Vendor" },
  "vend.col.vendors": { ru: "Подр-ков", en: "Vendors" },
  "vend.deleteMr": { ru: "Удалить MR", en: "Delete MR" },
  "vend.editMr": { ru: "Редактировать", en: "Edit" },
  "vend.editTitle": { ru: "Редактировать MR", en: "Edit MR" },
  "vend.fTitle": { ru: "Название", en: "Title" },
  "vend.fEquip": { ru: "Оборудование", en: "Equipment" },
  "vend.fDeadline": { ru: "Дедлайн (12:00 МСК)", en: "Deadline (12:00 MSK)" },
  "vend.fCurrency": { ru: "Валюта", en: "Currency" },
  "vend.save": { ru: "Сохранить", en: "Save" },
  "vend.cancel": { ru: "Отмена", en: "Cancel" },
  "vend.matSummary": { ru: "Material Summary — позиции", en: "Material Summary — items" },
  "vend.addTag": { ru: "+ Тег", en: "+ Tag" },
  "vend.ownerChecklist": { ru: "Чек-лист заказчика — что загрузить", en: "Owner checklist — what to upload" },
  "vend.addItem": { ru: "+ Пункт", en: "+ Item" },
  "vend.section": { ru: "раздел", en: "section" },
  "vend.vendorChecklist": { ru: "Чек-лист подрядчика — что предоставить", en: "Vendor checklist — what to provide" },
  "vend.invited": { ru: "Приглашённые подрядчики", en: "Invited vendors" },
  "vend.invite": { ru: "+ Пригласить", en: "+ Invite" },
  "vend.inviteNeedsOpen": { ru: "Сначала откройте приём заявок (статус «Приём открыт»)", en: "Open the MR for bids first (status «Open for bids»)" },
  "vend.revoke": { ru: "Отозвать", en: "Revoke" },
  "vend.st.invited": { ru: "Приглашён", en: "Invited" },
  "vend.st.entered": { ru: "Вошёл", en: "Signed in" },
  "vend.st.revoked": { ru: "Отозвано", en: "Revoked" },
  "vend.report": { ru: "Сводное сравнение цен", en: "Price comparison" },
  "vend.exportXlsx": { ru: "Экспорт в Excel", en: "Export to Excel" },
  "vend.total": { ru: "ИТОГО", en: "TOTAL" },
  "vend.minHint": { ru: "Зелёным выделена минимальная цена по позиции.", en: "Minimum price per item is highlighted green." },
  "vend.questions": { ru: "Вопросы подрядчиков", en: "Vendor questions" },
  "vend.noQuestions": { ru: "Вопросов пока нет.", en: "No questions yet." },
  "vend.reply": { ru: "Ответить", en: "Reply" },
  "vend.makePublic": { ru: "Сделать публичным", en: "Make public" },
  "vend.makePrivate": { ru: "Сделать приватным", en: "Make private" },
  "vend.qPublic": { ru: "Публичный", en: "Public" },
  "vend.qPrivate": { ru: "Приватный", en: "Private" },
  "vend.upload": { ru: "Загрузить", en: "Upload" },
  "vend.deadline": { ru: "Дедлайн", en: "Deadline" },
  "vend.discipline": { ru: "Дисциплина", en: "Discipline" },
  "vend.currency": { ru: "Валюта", en: "Currency" },
  "vend.project": { ru: "Проект", en: "Project" },
  "vsec.BID_INCLUSION": { ru: "Bid Check List — включить в КП", en: "Bid Check List — include in quotation" },
  "vsec.BID_NOTES": { ru: "Bid Check List — учесть Requisition Notes", en: "Bid Check List — acknowledge Requisition Notes" },
  "vsec.RFD": { ru: "RFD — документы к предоставлению", en: "RFD — documents to provide" },
  "st.DRAFT": { ru: "Черновик", en: "Draft" },
  "st.OPEN": { ru: "Приём заявок открыт", en: "Open for bids" },
  "st.CLOSED": { ru: "Приём закрыт", en: "Closed" },
  "st.AWARDED": { ru: "Победитель выбран", en: "Awarded" },
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
