# Бесплатный деплой MVP TDO (только через веб-интерфейс)

Ниже самый простой путь, если у вас нет доступа к ПК:

- **Backend**: Render Web Service (Free)
- **Frontend**: Render Static Site (Free)
- **Database**: Neon PostgreSQL (Free)

> Все делается в браузере, через GitHub + Render + Neon.

---

## 1) Подготовка GitHub

1. Убедитесь, что в репозитории есть актуальный код (уже сделано).
2. Репозиторий должен быть доступен Render (public или private с доступом).

---

## 2) Создать бесплатную БД в Neon

1. Зайдите на [https://neon.tech](https://neon.tech)
2. Создайте проект (Free plan).
3. Скопируйте connection string вида:

```text
postgresql://USER:PASSWORD@HOST/DB?sslmode=require
```

4. Для backend переменной `DATABASE_URL` используйте формат SQLAlchemy:

```text
postgresql+psycopg://USER:PASSWORD@HOST/DB?sslmode=require
```

---

## 3) Поднять Backend на Render

1. Зайдите на [https://render.com](https://render.com)
2. `New +` -> `Web Service`
3. Подключите GitHub репозиторий.
4. Настройки:
   - **Root Directory**: `backend`
   - **Environment**: `Python 3`
   - **Build Command**:
     ```bash
     pip install -r requirements.txt
     ```
   - **Start Command**:
     ```bash
     uvicorn app.main:app --host 0.0.0.0 --port $PORT
     ```
5. Добавьте Environment Variables:
   - `DATABASE_URL` = (строка из Neon в формате `postgresql+psycopg://...`)
   - `SECRET_KEY` = любой длинный случайный ключ
   - `FIRST_ADMIN_EMAIL` = `admin@ivamaris.io`
   - `FIRST_ADMIN_PASSWORD` = придумайте свой пароль
   - `FIRST_ADMIN_FULL_NAME` = `System Administrator`
   - `CORS_ORIGINS` = временно:
     ```text
     ["https://YOUR-FRONTEND.onrender.com"]
     ```

6. Нажмите Deploy.
7. Проверьте:
   - `https://YOUR-BACKEND.onrender.com/health`
   - `https://YOUR-BACKEND.onrender.com/docs`

---

## 4) Поднять Frontend на Render

1. В Render: `New +` -> `Static Site`
2. Выберите тот же GitHub репозиторий.
3. Настройки:
   - **Root Directory**: `frontend`
   - **Build Command**:
     ```bash
     npm install && npm run build
     ```
   - **Publish Directory**: `dist`
4. Environment Variable:
   - `VITE_API_URL` = `https://YOUR-BACKEND.onrender.com`
5. Deploy.

---

## 5) Финальная связка CORS

После того как фронтенд URL появился:

1. Откройте Backend service -> Environment.
2. Убедитесь, что `CORS_ORIGINS` точно равен:

```text
["https://YOUR-FRONTEND.onrender.com"]
```

3. Сделайте Manual Deploy backend еще раз.

---

## 6) Проверка системы (через веб)

1. Откройте frontend URL.
2. Войдите `FIRST_ADMIN_EMAIL / FIRST_ADMIN_PASSWORD`.
3. Проверьте сценарий:
   - создать пользователей,
   - создать MDR,
   - создать Document,
   - создать Revision,
   - создать Comment,
   - отправить Response,
   - проверить Notifications.

---

## 7) Ограничения бесплатного режима

- Render free может "засыпать" сервис при простое (первый запрос дольше).
- Подходит для демо/тестов, не для production SLA.

---

## 8) После теста (когда купите домен)

Можно перейти на:
- тот же Render (платный план + custom domain), или
- ваш корпоративный сервер (Docker Compose / Kubernetes).

Дальше перенос без переписывания кода: меняются только инфраструктура и переменные окружения.
