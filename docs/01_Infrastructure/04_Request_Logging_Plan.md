# Kế hoạch Triển khai: Request & Response Logging Module (MongoDB)

## 📌 Tóm tắt dự án
Xây dựng hệ thống ghi log tập trung cho các Outgoing Request ra bên ngoài:
1. **Crawl Requests**: Ghi lại mọi HTTP request cào dữ liệu tin tức (vào VnExpress, Vietnamnet, Cafeland, Batdongsan...) từ Crawler Service / Axios / Firecrawl.
2. **AI Extractor / Filter Requests**: Ghi lại mọi HTTP request gửi tới AI Provider (như DeepSeek, OpenAI, Custom Gateway) dùng để lọc bài viết, trích xuất thông tin, tóm tắt tin tức.

**Lưu ý:** Không ghi log các API Request thông thường từ Client/Admin/Mobile App tới NestJS Backend.

Tất cả log được lưu trữ trong MongoDB với đầy đủ metadata: Status code, Request Header/Body/Prompt, Response Header/Body/Completion, Execution Time (ms), Exception Stacktrace, Token Usage (cho AI), hỗ trợ tự động xóa log cũ (TTL) và mã hóa bớt dữ liệu nhạy cảm (Sanitization).

---

## 🏗️ Phân rã Nhiệm vụ & Phân công Agent

### Phase 1: Architecture & Data Schema (`architect-agent`)
- [ ] Thiết kế Mongoose Schema `ExternalRequestLog` (`external_request_logs` collection):
  - `type`: `'CRAWL_OUTGOING'` | `'AI_OUTGOING'`
  - `targetService` / `provider`: Tên dịch vụ hoặc trang cào (VD: `'VnExpress'`, `'Batdongsan'`, `'DeepSeek'`, `'OpenAI'`)
  - `method`: HTTP Method (`GET`, `POST`...)
  - `url` / `endpoint`: URL target cào hoặc AI API Endpoint
  - `statusCode`: HTTP Status Code (200, 400, 403 Cloudflare, 429 RateLimit, 500...)
  - `durationMs`: Thời gian phản hồi (ms)
  - `request`: `{ headers, query, params, body, prompt }`
  - `response`: `{ headers, body, choices, usage: { promptTokens, completionTokens, totalTokens } }` (Cắt ngắn tối đa 50KB nếu body quá lớn)
  - `error`: `{ message, code, stack }` (nếu có ngoại lệ/thất bại)
  - `sourceModule`: Tên module phát ra request (VD: `CustomCrawlerService`, `AiFilterService`)
  - `createdAt`: Timestamp (dùng cho TTL Index)
- [ ] Thiết kế quy tắc Masking/Sanitization:
  - Tự động ẩn API Key trong Header (`Authorization`, `x-api-key`, `Bearer ...`) và các bí mật khác.
- [ ] Cấu hình Indexing & Retention Policy:
  - Compound Index: `{ type: 1, createdAt: -1 }`, `{ targetService: 1 }`, `{ statusCode: 1 }`
  - TTL Index: Tự động dọn dẹp log sau 30 ngày (`expireAfterSeconds: 2592000`).

---

### Phase 2: Backend Implementation (`coder-backend-agent`)
- [ ] **Tạo Module:** `ExternalLogModule` trong `RealEstateBackendApp/src/modules/external-log/`
  - Schema, Service, Controller, DTOs.
- [ ] **Crawl Request Logger (`CrawlLoggerService`):**
  - Intercept / Wrapping vào `CustomCrawlerService` & `FirecrawlService`.
  - Ghi nhận URL cào, Status Code (200, 403 anti-bot, 503), HTML/JSON payload.
- [ ] **AI Request Logger (`AiLoggerService`):**
  - Intercept / Wrapping vào `AiFilterService` & `AiPromptConfigService`.
  - Ghi nhận AI Provider Endpoint, Model name, Prompt gửi đi, Raw JSON Response trả về, Token count và Execution time.
- [ ] **Fire-and-forget Mechanism:**
  - Ghi log theo cơ chế Async Non-blocking để tuyệt đối không làm chậm tốc độ crawl và tốc độ xử lý AI.
- [ ] **Admin Query APIs:**
  - `GET /api/v1/external-logs`: Phân trang (Pagination), Filter theo `type` (`CRAWL_OUTGOING` / `AI_OUTGOING`), `targetService`, `statusCode`, `dateRange`.
  - `GET /api/v1/external-logs/:id`: Xem chi tiết 1 bản ghi log (Prompt, Payload, Error Stack).

---

### Phase 3: Frontend Log Management UI (`coder-frontend-agent`)
- [ ] **Xây dựng Màn hình Quản lý "External Logs" trong `RealEstateAdminApp`:**
  - Tab 1: **Crawl Logs** (Theo dõi status cào từng trang báo, phát hiện trang bị 403 Cloudflare/Anti-bot).
  - Tab 2: **AI Logs** (Theo dõi lịch sử request gọi AI, xem Prompt, Response và Token Usage).
  - Bộ lọc: Filter theo Provider, Status Code, Khoảng thời gian, Từ khóa Search.
  - Drawer / Modal "Chi tiết Request & Response": Hiển thị JSON prettify cho Prompt / Request Body & Response Body với nút Copy.

---

### Phase 4: DevOps & Performance Tuning (`devops-agent`)
- [ ] Cấu hình MongoDB Indexing tối ưu cho bảng `external_request_logs`.
- [ ] Khai báo biến môi trường `.env`:
  - `ENABLE_EXTERNAL_LOGGING=true`
  - `LOG_RETENTION_DAYS=30`
  - `MAX_LOG_BODY_BYTES=51200`

---

### Phase 5: QA & Security Audit (`qa-agent`) [BẮT BUỘC]
- [ ] **Security Audit:** Đảm bảo `API_KEY` của AI Provider (OpenAI/DeepSeek API Keys) không bị lưu plain-text vào database log.
- [ ] **Performance Test:** Đảm bảo khi cào đồng thời hàng trăm bài viết hoặc gọi AI batch không làm đầy RAM hay đơ thread DB.
- [ ] **Test Scenarios:**
  - Crawl thử bài viết gặp lỗi 403 Anti-bot -> kiểm tra log có bắt được 403 kèm raw HTML error.
  - Gọi AI Filter với prompt bị lỗi/invalid API key -> kiểm tra log có ghi đủ error stack trace.

---

## 🎯 Verification Criteria (Tiêu chí Nghiệm thu)
1. 100% Crawl Outgoing Request được ghi log với đầy đủ Target URL, Status Code, Duration.
2. 100% AI Outgoing Request được ghi log với đầy đủ Model, Prompt, Response, Token Usage.
3. Không ghi bất kỳ API Request nội bộ nào từ Client/Admin/Mobile App.
4. API Key / Secret Header được che chắn an toàn (`***REDACTED***`).
5. Giao diện Admin phân chia 2 Tab (Crawl Logs & AI Logs) hiển thị mượt mà.
