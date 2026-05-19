FROM node:20-slim

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY scripts/ensure-electron-symlink.cjs ./scripts/ensure-electron-symlink.cjs
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Expose port
EXPOSE 3000

# Start the web API by default; Railway worker service sets SERVICE_ROLE=worker.
CMD ["sh", "-c", "if [ \"$SERVICE_ROLE\" = \"worker\" ]; then npm run worker; else npm run start; fi"]
