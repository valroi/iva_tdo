FROM node:22-alpine

WORKDIR /app

# Pin npm to current major; node:22-alpine ships 10.9.x which warns about 11.x.
# Обновляемся явно, чтобы CI не сыпал "npm notice New major version" в логи
# и чтобы поведение `npm ci` совпадало с прод-окружением.
RUN npm install -g npm@11.16.0

COPY package.json package-lock.json /app/
RUN npm ci

COPY . /app

EXPOSE 3000

CMD ["npm", "run", "dev"]
