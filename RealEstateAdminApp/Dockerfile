# ── Stage 1: Build React/Vite app ─────────────────────────────────────────────
FROM node:24.18.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_API_URL phải truyền lúc build vì Vite bundle biến vào JS
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
# Cờ module CRM (Vite nhúng lúc build). Mặc định tắt; compose truyền giá trị cùng biến với backend.
ARG VITE_CRM_ENABLED=false
ARG VITE_FEATURE_CRM_ATTACHMENTS=false
ARG VITE_CRM_MOCK_REPORTS=false
ARG VITE_CRM_MOCK_IMPORT_EXPORT=false
ENV VITE_CRM_ENABLED=$VITE_CRM_ENABLED
ENV VITE_FEATURE_CRM_ATTACHMENTS=$VITE_FEATURE_CRM_ATTACHMENTS
ENV VITE_CRM_MOCK_REPORTS=$VITE_CRM_MOCK_REPORTS
ENV VITE_CRM_MOCK_IMPORT_EXPORT=$VITE_CRM_MOCK_IMPORT_EXPORT
RUN npm run build

# ── Stage 2: Nginx để serve static files ──────────────────────────────────────
FROM nginx:1.27-alpine AS production
# nginx.conf là TEMPLATE: entrypoint của image nginx chính thức (20-envsubst-on-templates.sh) thay biến rồi ghi ra
# /etc/nginx/conf.d/default.conf mỗi lần container khởi động (FR-16). NGINX_ENVSUBST_FILTER là regex theo TÊN biến:
# chỉ thay đúng 3 biến dưới đây, mọi `$uri`, `$host`, `$remote_addr`... của nginx được giữ nguyên.
# Giá trị mặc định cho chạy image đơn lẻ; docker-compose.yml truyền giá trị thật (IP cloudflared tĩnh, v.v.).
#   BACKEND_UPSTREAM : origin backend, KHÔNG có dấu `/` cuối và không có path (nginx ghép `/api/`)
#   TRUSTED_PROXY_IP : đúng MỘT IP được tin CF-Connecting-IP (set_real_ip_from); mặc định loopback = không tin ai ngoài
#   CLIENT_MAX_BODY  : giới hạn body cho /api/ (>= giới hạn upload của backend, 5 MB + dư multipart)
# (mỗi ENV một dòng, không dùng "\" nối dòng: Dockerfile CRLF của repo làm BuildKit hiểu sai "\" + CR)
ENV BACKEND_UPSTREAM=http://backend:3000
ENV TRUSTED_PROXY_IP=127.0.0.1
ENV CLIENT_MAX_BODY=6m
ENV NGINX_ENVSUBST_FILTER='^(BACKEND_UPSTREAM|TRUSTED_PROXY_IP|CLIENT_MAX_BODY)$'
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
