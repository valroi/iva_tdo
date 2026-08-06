// Общий конфиг пагинации таблиц: переключатель размера страницы
// (10/20/30/50/100) с запоминанием выбора в localStorage по ключу таблицы.

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50", "100"];
const DEFAULT_PAGE_SIZE = 20;

function storageKey(tableKey: string): string {
  return `tdo_pagesize_${tableKey}`;
}

function readSize(tableKey: string): number {
  if (typeof window === "undefined") return DEFAULT_PAGE_SIZE;
  const raw = window.localStorage.getItem(storageKey(tableKey));
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_PAGE_SIZE;
}

function persistSize(tableKey: string, size: number): void {
  if (typeof window !== "undefined") window.localStorage.setItem(storageKey(tableKey), String(size));
}

/** Проп `pagination` для antd Table с сохраняемым размером страницы. */
export function paginationProps(tableKey: string) {
  return {
    defaultPageSize: readSize(tableKey),
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    showTotal: (total: number) => `Всего: ${total}`,
    onShowSizeChange: (_current: number, size: number) => persistSize(tableKey, size),
    onChange: (_page: number, size: number) => persistSize(tableKey, size),
  };
}
