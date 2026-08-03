# ── Stage 1: Production deps (native modules compiled on Alpine) ──────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
# Tạo trước thư mục logs owned bởi user node (app chạy USER node, không thể tự
# tạo /app/logs vì /app thuộc root). daily-rotate-file sẽ ghi vào đây.
RUN mkdir -p logs && chown -R node:node logs
COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
