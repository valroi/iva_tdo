# Переезд IvaMaris TDO в облако: мощности, провайдер, настройка, цены

Дата: 2026-07-14. Цены ориентировочные (вилки по тарифным линейкам провайдеров;
перед заказом проверить калькулятором — ссылки в §3). Курс и тарифы меняются.

---

## 1. Серверные мощности

Система = docker-compose: Postgres + backend (FastAPI + ML-эмбеддинги bge-m3
~2 GB RAM) + frontend (nginx) + Qdrant + Caddy (TLS). Все данные в volumes.

| Профиль | vCPU | RAM | Диск (NVMe) | Когда |
|---|---|---|---|---|
| **Старт** | 2 | 8 GB | 100 GB | пилот, ≤10 пользователей, AI-поиск редкий |
| **Рекомендуемый** | **4** | **16 GB** | **250 GB** | текущая нагрузка: подрядчики извне, RAG-агент, 2700+ докум. |
| Рост (год+) | 8 | 32 GB | 500 GB–1 TB | 50+ пользователей, несколько проектов, тяжёлый архив |

Раскладка RAM рекомендуемого: Postgres ~2 GB · backend+bge-m3 ~3–4 GB (пики
реиндекса) · Qdrant ~0.5 GB · ОС/запас ~4 GB. Диск: файлы документации
растут ~10–30 GB/год + образы ~7 GB + запас.

**Отдельно (не на той же машине):**
- **Объектное хранилище S3** под бэкапы: от 50 GB, ~150–500 ₽/мес.
- Резерв IP + домен (~200–400 ₽/год домен .ru).

---

## 2. Требования к провайдеру (чек-лист при выборе)

Обязательные:
- [ ] **VM на KVM** (не OpenVZ/LXC — Docker нужен полноценный), Ubuntu 22.04/24.04 LTS
- [ ] **NVMe-диск** (БД+файлы; SATA заметно медленнее)
- [ ] **Публичный статический IPv4** (для домена и писем подрядчикам)
- [ ] Открытые порты 80/443 наружу, **без принудительного NAT**
- [ ] **Снапшоты/бэкапы VM** на стороне провайдера (доп. защита к нашим бэкапам)
- [ ] **S3-совместимое объектное хранилище** в том же облаке (бэкапы)
- [ ] Возможность **вертикального апгрейда** VM (CPU/RAM/диск) без пересоздания
- [ ] **РФ-юрисдикция и 152-ФЗ** (персональные данные сотрудников/подрядчиков
      должны храниться в РФ) + оплата по счёту для юрлица (ООО)
- [ ] SLA ≥ 99.8%, техподдержка 24/7

Желательные (для роста):
- [ ] Managed PostgreSQL (вынести БД, когда вырастем)
- [ ] Приватные сети/VPC (второй сервер без публичного IP)
- [ ] Защита от DDoS на L3/L4 в тарифе

**НЕ нужны**: Kubernetes, GPU, Windows-лицензии, панели типа cPanel.

---

## 3. Провайдеры и ориентир цен (конфигурация 4 vCPU / 16 GB / 250 GB NVMe)

| Провайдер | Ориентир, ₽/мес | Плюсы | Минусы |
|---|---|---|---|
| **Timeweb Cloud** | ~4 500–6 500 | дешевле всех, простая панель, S3 есть, быстрый старт | меньше managed-сервисов |
| **Selectel** | ~6 000–9 000 | гибкий конфигуратор, сильный S3, managed PG, снапшоты | дороже, тарифы выросли в 2026 (+8–9%) |
| **Yandex Cloud** | ~8 000–12 000 | самый широкий стек managed, гранты новым, DDoS-защита | сложнее биллинг, дороже при 24/7 |
| VK Cloud | ~7 000–10 000 | 152-ФЗ аттестация,бизнес-договоры | панель тяжелее |

Калькуляторы: [selectel.ru/prices](https://selectel.ru/prices/) ·
[timeweb.cloud/prices](https://timeweb.cloud/prices) · cloud.yandex.ru/prices.

**Рекомендация:** старт на **Timeweb Cloud** (цена/простота) или **Selectel**
(если сразу нужен managed Postgres на вырост). Итог бюджета на рекомендуемый
профиль: **~5–9 тыс ₽/мес** за VM + ~300 ₽/мес S3-бэкапы + домен.

Полный бюджет с запасом: **6 000–10 000 ₽/мес** сейчас; при росте до профиля
«8 vCPU/32 GB» — ~12 000–18 000 ₽/мес.

---

## 4. Инструкция настройки (после заказа VM)

Предполагается: Ubuntu 24.04, root-доступ по SSH, домен `tdo.company.ru`
с A-записью на IP сервера.

### 4.1. Базовая подготовка (15 мин)
```bash
ssh root@<IP>
apt update && apt upgrade -y
adduser deploy && usermod -aG sudo deploy          # не работать под root
# SSH-ключи, потом в /etc/ssh/sshd_config: PasswordAuthentication no
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

### 4.2. Docker (5 мин)
```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

### 4.3. Система (20 мин)
```bash
su - deploy
git clone <репозиторий> iva_tdo && cd iva_tdo
cp .env.example .env && nano .env
```
Заполнить `.env` (полный перечень — SYSADMIN_DEPLOY_RU §3 и §10.2). Критичное:
```dotenv
APP_ENV=production
DOMAIN=tdo.company.ru
VITE_API_URL=                  # пусто!
PUBLIC_BASE_URL=https://tdo.company.ru
CORS_ORIGINS=["https://tdo.company.ru"]
SECRET_KEY=<64+ случайных>
FIRST_ADMIN_PASSWORD=<свой>
POSTGRES_PASSWORD=<32+ случайных>
SMTP_*                          # корпоративная почта (письма подрядчикам)
AI_API_KEY=<OpenRouter>         # опционально, умный поиск
```
Запуск (интернет-режим: наружу только Caddy с авто-HTTPS):
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose ps        # все контейнеры Up; caddy сам получит сертификат
```
Проверка: `https://tdo.company.ru` открывается с замком; вход админа работает;
6 неверных паролей → блок (429).

### 4.4. Перенос данных с текущего сервера (если есть прод в LAN)
На старом сервере:
```bash
docker compose exec -T db pg_dump -U tdo_app tdms | gzip > tdms.sql.gz
for v in tdo_uploads smart_upload vendor_uploads feed_storage qdrant_data; do
  docker run --rm -v iva_tdo_${v}:/data -v $PWD:/backup alpine tar czf /backup/${v}.tar.gz -C /data .
done
scp *.gz *.tar.gz deploy@<новый_IP>:~/migrate/
```
На новом (при остановленном backend):
```bash
gunzip -c tdms.sql.gz | docker compose exec -T db psql -U tdo_app tdms
for v in tdo_uploads smart_upload vendor_uploads feed_storage qdrant_data; do
  docker run --rm -v iva_tdo_${v}:/data -v $PWD:/backup alpine tar xzf /backup/${v}.tar.gz -C /data
done
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 4.5. Бэкапы в S3 (30 мин, обязательный пункт)
Создать бакет в S3 провайдера, поставить `rclone` (`apt install rclone`,
`rclone config` → S3 → ключи из панели). Крон (`crontab -e`):
```bash
30 2 * * * cd ~/iva_tdo && docker compose exec -T db pg_dump -U tdo_app tdms | gzip > /tmp/tdms_$(date +\%F).sql.gz && rclone move /tmp/tdms_$(date +\%F).sql.gz s3:tdo-backup/db/
0 3 * * 0 for v in tdo_uploads smart_upload vendor_uploads feed_storage; do docker run --rm -v iva_tdo_${v}:/data -v /tmp:/b alpine tar czf /b/${v}_$(date +\%F).tar.gz -C /data . && rclone move /tmp/${v}_$(date +\%F).tar.gz s3:tdo-backup/files/; done
```
(БД — ежедневно, файлы — еженедельно; хранить 30 дней — lifecycle-правило в бакете.)
Плюс включить **снапшоты VM** у провайдера (ежедневные, 7 шт.).

### 4.6. Мониторинг-минимум (10 мин)
- Uptime-пинг `https://tdo.company.ru/api/v1/../health` внешним сервисом
  (UptimeRobot бесплатно) → алерт в почту/телеграм.
- `docker compose logs backend | grep -iE "error"` — раз в неделю глазами,
  либо панель провайдера (CPU/RAM/диск алерты ≥80%).

### 4.7. Обновления (штатно)
```bash
cd ~/iva_tdo && git pull origin main
docker compose -f docker-compose.yml -f docker-compose.prod.yml build backend frontend
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```
Данные в volumes — не затрагиваются. Никогда `down -v`.

---

## 5. План расширения (когда упрёмся)

| Симптом | Шаг | Стоимость |
|---|---|---|
| RAM >80% стабильно | апгрейд VM 4→8 vCPU, 16→32 GB (кнопкой в панели, даунтайм минуты) | +5–8 тыс ₽/мес |
| БД тяжёлая / нужен HA | вынести на **Managed PostgreSQL** провайдера, DATABASE_URL поменять | от ~4 тыс ₽/мес |
| Реиндекс/эмбеддинги мешают API | второй малый VM под Qdrant+эмбеддинги (QDRANT_URL по приватной сети) | +2–3 тыс ₽/мес |
| Файлов сотни ГБ | файловые тома → bind-mount на подключаемый сетевой диск / S3-шлюз | по объёму |
| Много внешних подрядчиков | DDoS-защита L7 провайдера перед Caddy | от ~2 тыс ₽/мес |

Архитектура уже готова к этому: пути хранилищ и адреса сервисов — env-переменные,
ничего в коде менять не нужно.
