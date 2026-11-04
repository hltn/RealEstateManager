# ── Stage 1: Production deps ──────────────────────────────────────────────────
FROM node:24.18.1-slim AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:24.18.1-slim AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# Đưa số phiên bản vào image (PT-027): dist/version.json = { version (từ package.json), commit (build arg) }.
# Stage production KHÔNG có package.json nên runner migration (dist/migrations/cli.js) đọc file này (rồi mới fallback package.json).
# Đặt SAU `npm run build` để đổi GIT_COMMIT chỉ làm lại lớp nhỏ này, không làm mất cache bước build.
ARG GIT_COMMIT=unknown
RUN node -e "const c = process.env.GIT_COMMIT; require('fs').writeFileSync('dist/version.json', JSON.stringify({ version: require('./package.json').version, commit: c && c !== 'unknown' ? c : null }) + '\n')"

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:24.18.1-slim AS production
WORKDIR /app
# Tạo trước thư mục logs owned bởi user node (app chạy USER node, không thể tự
# tạo /app/logs vì /app thuộc root). daily-rotate-file sẽ ghi vào đây.
RUN mkdir -p logs tmp && chown -R node:node logs tmp
COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
