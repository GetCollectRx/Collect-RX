FROM node:22-slim

RUN apt-get update \
  && apt-get install -y openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ARG CACHEBUST=20260609a

WORKDIR /app

# Copy only the inner app manifests — avoids workspace root lock file entirely.
COPY Collect-RX-main/package.json Collect-RX-main/package-lock.json ./
COPY Collect-RX-main/prisma ./prisma/

# The deploy workflow copies the canonical workspace lock into this build
# context. Fail rather than resolving a different dependency graph.
RUN npm ci --ignore-scripts --include=dev

# Prisma client generation must happen after install.
RUN npx prisma generate

# Copy the full app source on top of the installed node_modules.
COPY Collect-RX-main/ ./

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
