FROM node:20-slim

RUN apt-get update \
  && apt-get install -y openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace: root package.json declares Collect-RX-main as the only workspace.
# We copy both manifests + the prisma schema first so Docker layer caching works.
COPY package.json package-lock.json ./
COPY Collect-RX-main/package.json ./Collect-RX-main/
COPY Collect-RX-main/prisma ./Collect-RX-main/prisma/

# Install all workspace deps from the root lock file.
# Plain `npm ci` at a workspace root installs root + every workspace and
# hoists shared deps into /app/node_modules, which is what tsc/vite expect.
# --ignore-scripts skips electron-builder and similar GUI-only postinstalls
# that fail in a slim container.
# Install devDependencies too (tsx, typescript, vite were required for build; tsx for `npm run start`).
RUN npm ci --ignore-scripts --include=dev

# Generate the Prisma client inside the workspace package.
WORKDIR /app/Collect-RX-main
RUN npx prisma generate

# Bring in the rest of the app source.
COPY Collect-RX-main/ ./

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
