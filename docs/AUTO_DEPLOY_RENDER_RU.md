# Авто-деплой после проверки (GitHub Actions + Render Deploy Hooks)

Этот файл описывает, как включить автоматический деплой после успешной проверки.

## Что уже добавлено в репозиторий

- Workflow: `.github/workflows/verify-and-deploy-render.yml`
- Логика:
  1. Backend: установка зависимостей + `pytest`
  2. Frontend: `npm ci` + `npm run build`
  3. Если оба шага успешны -> вызов Render Deploy Hook для backend и frontend

## Что нужно сделать в Render (1 раз)

Для каждого сервиса на Render:

1. Открыть сервис.
2. Перейти в `Settings` -> `Deploy Hook`.
3. Создать hook и скопировать URL.

Нужны два URL:
- hook backend
- hook frontend

## Что нужно сделать в GitHub (1 раз)

В репозитории GitHub:

1. `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`
2. Добавить (поддерживаются оба варианта имен):
   - backend:
     - `RENDER_BACKEND_DEPLOY_HOOK_URL` **или**
     - `RENDER_BACKEND_DEPLOY_HOOK`
   - frontend:
     - `RENDER_FRONTEND_DEPLOY_HOOK_URL` **или**
     - `RENDER_FRONTEND_DEPLOY_HOOK`

## Как работает авто-деплой

- Пуш в `main` и `cursor/**`:
  - запускаются проверки
  - при успехе автоматически вызывается деплой Render

- Ручной запуск:
  - можно запустить workflow вручную из вкладки Actions (`workflow_dispatch`)

## Почему на сайте могли быть "старые данные"

Частые причины:
1. Деплой делался из другой ветки, а не из текущей рабочей.
2. Render не получил новый билд (не было автотриггера/хука).
3. Frontend ссылается на старый backend URL (`VITE_API_URL`).
4. В backend остались старые данные в БД.

## Быстрый чек-лист

1. В Render проверить branch для frontend/backend.
2. В Render проверить `VITE_API_URL` у frontend.
3. В GitHub Actions убедиться, что workflow зеленый.
4. В Render убедиться, что после workflow стартовал новый deploy.

