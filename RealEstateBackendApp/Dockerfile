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

# ── Stage dev (TÙY CHỌN: chỉ docker-compose.dev-watch.yml dùng, `build: target: dev`; KHÔNG dùng cho staging/production) ──
# Dựa trên builder (đủ devDependencies + toàn bộ mã nguồn); compose mount ./RealEstateBackendApp/src đè lên /app/src và chạy `nest start --watch`
# (tự biên dịch lại khi sửa mã). Chạy USER node như production: chỉ /app (để tsc ghi tsbuildinfo), dist, logs, tmp, state thuộc node; node_modules
# và mã nguồn trong image vẫn của root. Xóa dist và *.tsbuildinfo do builder dựng bằng root để node ghi/xóa được. Stage này đặt TRƯỚC `production`
# để stage cuối (mặc định của `docker build` không có --target) vẫn là production.
FROM builder AS dev
RUN rm -rf dist ./*.tsbuildinfo && mkdir -p dist logs tmp state && chown node:node /app dist logs tmp state
USER node
EXPOSE 3000
CMD ["npx", "nest", "start", "--watch"]

# ── Stage 3: Production runtime ───────────────────────────────────────────────
FROM node:24.18.1-slim AS production
WORKDIR /app
# Tạo trước thư mục logs owned bởi user node (app chạy USER node, không thể tự
# tạo /app/logs vì /app thuộc root). daily-rotate-file sẽ ghi vào đây.
# Thêm state/: thư mục chứa cron.env (CRON_CONFIG_FILE=/app/state/cron.env, FR-19). Docker named volume
# `backend_state` mount vào đây sẽ thừa hưởng chủ sở hữu node:node của thư mục này khi volume còn RỖNG
# (lần tạo đầu), nên USER node ghi được; không có dòng mkdir/chown này thì volume sinh ra thuộc root và ghi lỗi.
RUN mkdir -p logs tmp state && chown -R node:node logs tmp state
COPY --from=deps    --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist         ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
