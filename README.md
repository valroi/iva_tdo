# iva_tdo

MVP системы технического документооборота (TDO / TDMS) для процесса:

- реестр MDR,
- документы и ревизии,
- комментарии/ответы (CRS/ACRS),
- статусы AP/AN/CO/RJ,
- уведомления,
- role-based доступ.

## Стек

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL
- **Frontend**: React + TypeScript + Ant Design
- **Infra**: Docker Compose, Redis, MinIO

## Быстрый старт

```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend docs: http://localhost:8000/docs
- Health: http://localhost:8000/health

Демо-логин:
- email: `admin@ivamaris.io`
- password: `admin123`

## Документация

- Архитектура: [`docs/ARCHITECTURE_RU.md`](docs/ARCHITECTURE_RU.md)
- Тестирование: [`docs/TESTING_GUIDE_RU.md`](docs/TESTING_GUIDE_RU.md)

## Backend тесты

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pytest -q
```
