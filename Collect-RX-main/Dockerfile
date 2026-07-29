FROM node:22-slim

RUN apt-get update \
&& apt-get install -y openssl ca-certificates python3 make g++ \
&& rm -rf /var/lib/apt/lists/*

# Bump to bust a stale cached build layer.
ARG CACHEBUST=20260703b
# Previously declared but never referenced in a RUN, so bumping the value
# above never actually busted the build cache — Depot kept serving a stale
# COPY . . layer regardless. This RUN consumes the ARG so future bumps
# genuinely invalidate the cache from this point down.
RUN echo "cachebust: ${CACHEBUST}" > /dev/null

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/ensure-electron-symlink.cjs ./scripts/ensure-electron-symlink.cjs
COPY prisma ./prisma/

# npm install (not ci) — avoids lock-file sync failures across npm versions.
# Allow scripts to run so native modules (@tailwindcss/oxide) build properly.
RUN npm install --include=dev

RUN npx prisma generate

COPY . .

RUN npm run build \
&& test -f dist/resources/index.html \
&& test -f dist/resources/dental-insurance-follow-up-canada/index.html \
&& test -f dist/resources/canadian-dental-carriers-follow-up/index.html \
&& test -f dist/resources/cdcp-claims-canada/index.html

EXPOSE 3000

CMD ["sh", "-c", "if [ \"$SERVICE_ROLE\" = \"worker\" ]; then npm run worker; else npm run start; fi"]
