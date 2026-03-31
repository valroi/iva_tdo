# Как протестировать MVP TDO

Этот гайд подходит для:
- **персонального компьютера** (Windows/macOS/Linux с Docker Desktop),
- **VPS/выделенного сервера** (Linux + Docker Engine).

## 1) Быстрый запуск (рекомендуется)

1. Скопируйте переменные:

```bash
cp .env.example .env
```

2. Поднимите систему:

```bash
docker compose up --build
```

3. Откройте:
- Frontend: `http://localhost:3000`
- Backend Swagger: `http://localhost:8000/docs`

4. Войдите в систему:
- email: `admin@ivamaris.io`
- password: `admin123`

---

## 2) Ручной сценарий теста (бизнес-flow)

### A. Подготовка ролей
1. Зайдите под admin.
2. Через API (`POST /api/v1/users`) создайте:
   - подрядчика (`contractor_manager`)
   - проверяющего заказчика (`owner_reviewer`)
3. Для входа под разными ролями используйте два отдельных окна браузера:
   - обычное окно = подрядчик
   - инкогнито/приватное окно = заказчик
   Так сессии не будут перетирать друг друга.

### B. Реестр MDR
1. Под подрядчиком создайте MDR запись.
2. Проверьте, что запись появилась в таблице MDR.

### C. Документ и ревизия
1. Создайте Document на основе MDR.
2. Создайте Revision `A` с `issue_purpose=IFR`.
3. Проверьте у заказчика уведомление о новой ревизии.

### D. Комментарии
1. Под заказчиком создайте Comment (OPEN, page/area).
2. Под подрядчиком дайте response на комментарий.
3. Проверьте, что появился ответ и обновился статус.

### E. Workflow
1. Откройте `/api/v1/workflow/statuses`.
2. Убедитесь, что есть AP/AN/CO/RJ.
3. Измените цвет/название статуса (admin) и проверьте отражение в UI.

### F. Проверка управления пользователями (Main Admin)
1. Создайте второго администратора (`role=admin`, `company_type=admin`) через `POST /api/v1/users`.
2. Войдите под вторым админом и убедитесь:
   - он может создавать обычных пользователей,
   - он **не может** назначать роль `admin`.
3. Под главным админом:
   - смените роль пользователя через `PUT /api/v1/users/{id}/role`,
   - деактивируйте через `PUT /api/v1/users/{id}/active` (`is_active=false`),
   - (опционально) удалите через `DELETE /api/v1/users/{id}`.
4. Убедитесь, что деактивированный пользователь не может войти.

### G. Саморегистрация + апрув
1. Отправьте заявку: `POST /api/v1/auth/register-request`.
2. Под главным админом откройте список: `GET /api/v1/users/registration-requests`.
3. Одобрите заявку: `POST /api/v1/users/registration-requests/{id}/approve`.
4. Проверьте, что пользователь теперь может залогиниться.

---

## 3) Автотест backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```

Если `venv` недоступен в вашей системе, используйте fallback:

```bash
cd backend
python3 -m pip install --user -r requirements.txt
python3 -m pytest -q
```

Тест покрывает: login → user create → MDR → document → revision → comment → response → notifications.

---

## 4) Можно ли тестировать на персональном компьютере?

**Да, можно полностью.**

Минимум:
- Docker Desktop 4.x+
- 8 GB RAM (желательно 16 GB)
- 10+ GB свободного места

Если без Docker, тоже возможно (отдельно Python/Node/PostgreSQL), но Docker-режим проще и стабильнее.

---

## 5) Деплой на домен и сервер

После локальной проверки:
1. Берете VPS (Ubuntu 22.04/24.04).
2. Ставите Docker + Docker Compose plugin.
3. Клонируете репозиторий, настраиваете `.env`.
4. Поднимаете `docker compose up -d --build`.
5. Добавляете reverse proxy (Nginx/Caddy) + TLS (Let's Encrypt).

Рекомендуется:
- вынести PostgreSQL/MinIO в managed/отдельные диски,
- включить бэкапы,
- добавить SMTP для email-уведомлений.

