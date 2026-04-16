# Доступ в систему (prod)

Демо-аккаунты ролей (`tdolead_ctr`, `dev_ctr`, `owner_lr`, `owner_rev`) в production отключены через `SEED_DEMO_USERS=false`.

Используются только административные учетные записи из переменных окружения:

| Назначение | Email (env) | Пароль (env) |
|---|---|---|
| Первый администратор | `FIRST_ADMIN_EMAIL` | `FIRST_ADMIN_PASSWORD` |
| Основной администратор | `MAIN_ADMIN_EMAIL` | `FIRST_ADMIN_PASSWORD` |

Пример для `.env`:

```env
FIRST_ADMIN_EMAIL=admin@company.com
FIRST_ADMIN_PASSWORD=<strong-password>
MAIN_ADMIN_EMAIL=platform.admin@company.com
SEED_DEMO_USERS=false
```
