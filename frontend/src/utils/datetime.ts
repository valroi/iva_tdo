export function formatDateTimeRu(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
}

export function formatDateRu(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Форматирование дедлайна: дата + всегда «12:00» (МСК).
 * Бэкенд хранит review_deadline как date (без времени) — при простом
 * `new Date(iso)` в МСК получается 03:00 (UTC midnight + 3ч). Это
 * выглядит дико. По соглашению все дедлайны заканчиваются к 12:00 МСК.
 */
export function formatDeadlineRu(value: string | null | undefined): string {
  if (!value) return "—";
  // Берём только date-часть, время заменяем на 12:00 фиксированно.
  // Поддерживаем и YYYY-MM-DD, и полный ISO с T.
  const datePart = String(value).slice(0, 10);
  const match = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    // Fallback на стандартное форматирование
    return formatDateTimeRu(value);
  }
  const [, yyyy, mm, dd] = match;
  return `${dd}.${mm}.${yyyy} 12:00`;
}
