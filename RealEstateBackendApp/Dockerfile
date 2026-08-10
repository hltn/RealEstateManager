# ── Stage 1: Production deps ──────────────────────────────────────────────────
FROM node:20-slim AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:20-slim AS production
WORKDIR /app
# Tạo trước thư mục logs owned bởi user node (app chạy USER node, không thể tự
# tạo /app/logs vì /app thuộc root). daily-rotate-file sẽ ghi vào đây.
RUN mkdir -p logs tmp && chown -R node:node logs tmp
COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/src/main"]
