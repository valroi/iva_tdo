# Инструкция для системного администратора: запуск и тест DOCchecker

Документ для быстрого вывода в тест/прод и проверки нового модуля `DOCchecker`.

## 1. Что уже в релизе

В `main` уже включены:

- модуль `DOCchecker` во frontend (переключатель `DCC / DOCchecker`);
- Smart Upload API в backend;
- загрузка одного PDF и пакетная загрузка многих PDF;
- иерархия хранения:
  - `project/document_category/discipline/title_code/cipher_without_revision/revision`;
- дерево файлов и предпросмотр PDF;
- реестр документов DOCchecker + фильтр-чат;
- дедупликация записей реестра (без дублей ревизий).

## 2. Обязательные предварительные условия

- Docker Engine + Docker Compose plugin установлены на сервере.
- Открыты порты:
  - `3000/tcp` (frontend),
  - `8000/tcp` (backend API).
- Порт `5432` наружу не публикуется (внутренний доступ только контейнерам).

## 3. Обновление сервера

В каталоге проекта:

```bash
git pull origin main
docker compose build --no-cache backend frontend
docker compose up -d
```

Проверка контейнеров:

```bash
docker compose ps
```

Проверка backend:

```bash
curl -s http://127.0.0.1:8000/health
```

Ожидается:

```json
{"status":"ok"}
```

## 4. Переменные окружения (минимум)

Проверьте в рабочем `.env`:

- `FIRST_ADMIN_EMAIL`
- `FIRST_ADMIN_PASSWORD`
- `MAIN_ADMIN_EMAIL`
- `SEED_DEMO_USERS=false`
- `VITE_API_URL=http://<SERVER_IP>:8000` (или публичный URL backend)

После правок `.env`:

```bash
docker compose up -d --force-recreate backend frontend
```

## 5. Где хранятся файлы DOCchecker

Текущее файловое хранилище модуля:

- `/tmp/tdo_smart_upload`

Если нужна полная очистка тестовых загрузок:

```bash
rm -rf /tmp/tdo_smart_upload
mkdir -p /tmp/tdo_smart_upload
```

## 6. Сценарий приемочного теста (smoke)

1. Открыть `http://<SERVER_IP>:3000`
2. Войти под админом.
3. В левом меню переключить модуль на `DOCchecker`.
4. Выполнить тесты:
   - **Single**: загрузить 1 PDF, нажать `Предпросмотр шифра`, затем `Подтвердить и разложить`.
   - **Batch**: загрузить несколько PDF, нажать `Обработать пакет PDF`.
5. Проверить:
   - дерево файлов отображается;
   - PDF открывается по кнопке `Просмотр PDF`;
   - записи появились в реестре;
   - в реестре нет дублей одной ревизии.

## 7. API для диагностики

При наличии access token:

- `GET /api/v1/smart-upload/tree` — дерево файлов;
- `GET /api/v1/smart-upload/registry` — реестр документов;
- `GET /api/v1/smart-upload/file?relative_path=...` — выдача PDF/файла;
- `POST /api/v1/smart-upload/process-batch` — batch-обработка PDF.

## 8. Частые проблемы

- `Invalid credentials`:
  - проверьте фактические `FIRST_ADMIN_EMAIL/FIRST_ADMIN_PASSWORD` в `.env`;
  - перезапустите backend.
- Пустой DOCchecker:
  - проверьте, что backend после обновления перезапущен;
  - проверьте `VITE_API_URL` у frontend.
- Повторные записи:
  - обновление с фиксом дедупликации должно быть в `main`;
  - сделать `git pull` и перезапуск backend.

## 9. Команда отката (если нужно)

```bash
git log --oneline -n 10
git checkout <stable_commit>
docker compose build backend frontend
docker compose up -d
```
