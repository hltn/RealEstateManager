# ── Stage 1: Build React/Vite app ─────────────────────────────────────────────
FROM node:24.18.1-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Không còn ARG/ENV VITE_*: cấu hình FE đọc LÚC CHẠY qua /env.js (FR-15) do entrypoint sinh từ env của container,
# nên một image dùng được cho mọi môi trường; đổi cờ chỉ cần đặt lại env và restart/tạo lại container, không build lại.
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
# Header bảo mật (T-41 D-1): file thường, KHÔNG phải template (không qua envsubst), được default.conf `include` ở cấp server và ở từng
# location có add_header riêng. Đặt ngoài /etc/nginx/conf.d để không bị nạp thành một cấu hình server độc lập.
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
# Entrypoint sinh /usr/share/nginx/html/env.js (window.__APP_CONFIG__) từ allowlist khóa env mỗi lần container khởi động.
# Image nginx chạy mọi /docker-entrypoint.d/*.sh có quyền thực thi theo thứ tự tên (sau 20-envsubst); giá trị sai thì
# script thoát khác 0 và container dừng, log chỉ nêu TÊN khóa. Khóa env (đặt ở compose/`docker run -e`): API_URL, CRM_ENABLED,
# CRM_ATTACHMENTS_ENABLED, CRM_PUSH_ENABLED, CRM_IMPORT_ENABLED, CRM_FEATURE_ZALO_ZNS, CRM_FEATURE_IN_APP_CALL,
# CRM_FEATURE_APPOINTMENT_SYNC, CRM_MOCK_REPORTS, CRM_MOCK_IMPORT_EXPORT và FRONTEND_URL (thành appUrl). Mặc định mọi cờ false, API_URL=/api/v1.
COPY docker-entrypoint.d/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
RUN chmod 755 /docker-entrypoint.d/40-runtime-config.sh
# Truy vết image về commit (release.sh build truyền --build-arg GIT_COMMIT; không có thì 'unknown'). Chỉ là metadata: không đổi cache các lớp trước.
ARG GIT_COMMIT=unknown
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
