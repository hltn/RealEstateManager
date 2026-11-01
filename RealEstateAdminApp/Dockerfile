# ── Stage 1: Build React/Vite app ─────────────────────────────────────────────
FROM node:20-alpine AS builder
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
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
