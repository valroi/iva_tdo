FROM node:22-alpine

WORKDIR /app

# npm из базового образа (10.9.x) используется как есть. In-place self-upgrade
# (npm install -g npm@11.x) на alpine ломает установку — теряется promise-retry
# в @npmcli/arborist (MODULE_NOT_FOUND). Нотис "New major version" косметический,
# поэтому npm НЕ обновляем — стабильность билда важнее.
COPY package.json package-lock.json /app/
RUN npm ci

COPY . /app

EXPOSE 3000

CMD ["npm", "run", "dev"]
