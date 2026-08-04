const MSK_TZ = "Europe/Moscow";

/**
 * Бэкенд хранит время как naive UTC (`datetime.utcnow()`, без tz-суффикса).
 * Голый `new Date("...")` для строки без tz трактует её как ЛОКАЛЬНОЕ время,
 * поэтому МСК-пользователь видел время на 3ч позади реального. Здесь строку
 * без tz трактуем как UTC (добавляем Z), и всё форматируем в Europe/Moscow.
 */
function parseAsUtc(value: string): Date | null {
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
  const date = new Date(hasTz ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTimeRu(value: string | null | undefined): string {
  if (!value) return "—";
  const date = parseAsUtc(String(value));
  if (!date) return String(value);
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MSK_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")} ${get("hour")}:${get("minute")}`;
}

export function formatDateRu(value: string | null | undefined): string {
  if (!value) return "—";
  const raw = String(value);
  // Дата-только (YYYY-MM-DD) — без сдвига tz (это плановые даты, не метки времени).
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, yyyy, mm, dd] = dateOnly;
    return `${dd}.${mm}.${yyyy}`;
  }
  const date = parseAsUtc(raw);
  if (!date) return raw;
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: MSK_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
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
