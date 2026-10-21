import { Alert } from "antd";
import { useEffect, useState } from "react";

import { getAnnouncement, type Announcement } from "../api";
import { formatDateTimeRu } from "../utils/datetime";

/** Бэкенд отдаёт naive UTC без суффикса — трактуем как UTC. */
function toTimestamp(value: string): number {
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasTz ? value : `${value}Z`).getTime();
}

function formatLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days > 0 ? `${days} дн ` : ""}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

interface Props {
  /** Поверх страницы (экран входа), а не в потоке разметки. */
  floating?: boolean;
}

/**
 * Объявление для всех пользователей с обратным отсчётом. Настраивается
 * администратором (Администрирование → «Объявление для всех пользователей»);
 * читается без авторизации, поэтому видно и на экране входа.
 */
export default function AnnouncementBanner({ floating = false }: Props): JSX.Element | null {
  const [data, setData] = useState<Announcement | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getAnnouncement()
        .then((value) => {
          if (!cancelled) setData(value);
        })
        .catch(() => {
          /* баннер необязателен — без него приложение работает */
        });
    void load();
    // Админ может поменять срок — подтягиваем раз в 5 минут.
    const refresh = window.setInterval(load, 5 * 60 * 1000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      window.clearInterval(tick);
    };
  }, []);

  if (!data?.enabled || !data.deadline) return null;
  const left = toTimestamp(data.deadline) - now;
  const expired = left <= 0;
  const deadlineLabel = `${formatDateTimeRu(data.deadline)} МСК`;

  return (
    <div
      style={
        floating
          ? { position: "fixed", top: 0, left: 0, right: 0, zIndex: 1100 }
          : { position: "sticky", top: 0, zIndex: 20 }
      }
    >
      <Alert
        banner
        type={expired ? "error" : "warning"}
        showIcon
        message={
          expired ? (
            <span>
              <b>Срок истёк ({deadlineLabel}).</b> {data.text}
            </span>
          ) : (
            <span>
              <b>
                До заморозки проекта: <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatLeft(left)}</span>
              </b>{" "}
              · до {deadlineLabel}. {data.text}
            </span>
          )
        }
      />
    </div>
  );
}
