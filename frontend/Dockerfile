# Прод-образ фронта: vite build → статика через nginx + прокси /api → backend.
# Раньше в «проде» крутился vite dev-сервер — медленно и небезопасно.

# --- Стадия 1: сборка ---
FROM node:22-alpine AS build

WORKDIR /app

# npm из базового образа (10.9.x) используется как есть. In-place self-upgrade
# (npm install -g npm@11.x) на alpine ломает установку — теряется promise-retry
# в @npmcli/arborist (MODULE_NOT_FOUND). Поэтому npm НЕ обновляем.
COPY package.json package-lock.json /app/
RUN npm ci

COPY . /app

# ПУСТОЙ VITE_API_URL = фронт ходит на относительный /api (nginx проксирует
# на backend) — работает и в LAN (:3000), и за Caddy (443), без CORS.
# process-env имеет приоритет над .env-файлами, случайно скопированный
# frontend/.env сборку не отравит.
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# --- Стадия 2: раздача ---
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
