FROM node:20-slim

RUN apt-get update \
  && apt-get install -y openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY Collect-RX-main/package*.json ./
COPY Collect-RX-main/prisma ./prisma/

RUN npm ci

RUN npx prisma generate

COPY Collect-RX-main/ ./

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
