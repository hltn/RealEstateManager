# Technical Design Document: NewsFireCrawlManager (Enterprise Standard)

Tài liệu này được viết lại bởi Architect Agent sau khi **audit trực tiếp code thật** (verify 2026-07-27), thay cho bản thiết kế cũ mang tính aspirational (mô tả "nên có" thay vì "đang có"). Mục đích: phân biệt rõ ràng **cái gì đã hoàn thiện** và **cái gì còn là GAP** (thiếu/vi phạm quy chuẩn `nodejs-react-mongo-coding-guidelines`), để `coder-agent` có checklist thực thi chính xác, tránh hiểu nhầm module đã an toàn 100%.

Quy ước đánh dấu trong tài liệu này:
- ✅ ĐÃ CÓ — đã implement đúng, kế thừa nguyên trạng.
- ⚠️ GAP — thiếu hoặc vi phạm quy chuẩn, cần `coder-agent` xử lý.

---

## 1. Data Model

Module có 3 collection cốt lõi (`news_sources`, `raw_articles`, `news_articles`) và 1 collection phụ (`market_analysis_histories`). Toàn bộ schema thật (field, type, index, quan hệ, Soft Delete, Zero-Downtime changelog) đã được audit và mô tả chi tiết tại:

→ **[`NEWS_MODULE_DATA_MODEL.md`](./NEWS_MODULE_DATA_MODEL.md)**

Tài liệu này không lặp lại code Schema. Ba điểm quan trọng nhất cần nhớ khi đọc phần API/Service dưới đây (chi tiết đầy đủ ở file trên):

- ⚠️ **Không có `deletedAt` ở bất kỳ schema nào** — toàn bộ delete hiện tại là hard delete (mục 6 của data model doc).
- ⚠️ **Không có `sourceId`/ObjectId reference** — `NewsArticle`/`RawArticle` chỉ liên kết mềm qua `source: string`, không `.populate()` được (mục 1 của data model doc).
- ⚠️ **`NewsStatus` là mảng** (`status: NewsStatus[]`, enum thật `CRAWLED | POSTED_WP | ERROR`, **không có `SAVED`**) — khác hoàn toàn mô tả cũ.

---

## 2. API Contract

### 2.1 Quy chuẩn chung — hiện trạng đối chiếu

| Quy chuẩn | Hiện trạng | Ghi chú |
|---|---|---|
| API Versioning `/api/v1/...` | ✅ ĐÃ CÓ | `main.ts` → `app.setGlobalPrefix('api/v1')`, verify trực tiếp |
| Swagger (`@ApiTags`, `@ApiOperation`, DTO decorators) | ✅ ĐÃ CÓ | Toàn bộ endpoint trong `news-fire-crawl-manager.controller.ts` đã có `@ApiOperation`/`@ApiTags`, DTO đã có `class-validator` decorators (theo commit `fix(api): add missing class-validator decorators`) |
| Global Error Format `{ statusCode, message, timestamp, path }` | ✅ ĐÃ CÓ | `GlobalExceptionFilter` (`common/filters/global-exception.filter.ts`) đăng ký global ở `main.ts`, đúng format chuẩn |
| Response List `{ data: T[], meta: { total, page, limit, totalPages } }` | ⚠️ GAP | `getRawArticles()` và `getArticles()` hiện trả `{ message, data: articles }` — **không có `meta`/phân trang**. Toàn bộ list bị load full (không `limit`/`skip`). Cần bổ sung phân trang thật khi data lớn dần. |
| RESTful — danh từ số nhiều, không động từ trong URL | ⚠️ Chấp nhận có ngoại lệ | Resource chính đúng chuẩn (`raw-articles`, `articles`). Các action-endpoint dạng RPC (`/crawl`, `/analyze`, `/analyze-raw`, `/articles/:id/publish`, `/articles/:id/clean`) dùng động từ — đây là pattern action-on-resource phổ biến và được chấp nhận (tương tự `POST /orders/:id/cancel`), không cần đổi. |

### 2.2 Idempotency-Key — GAP quan trọng

Thiết kế cũ ghi "Ràng buộc thép: Bắt buộc áp dụng cơ chế xác thực Header `Idempotency-Key`" cho publish WordPress. Verify thật tại `publishArticle()` (L452) và `publishBulkArticles()` (L427) trong `news-fire-crawl-manager.controller.ts`:

**⚠️ GAP — CHƯA IMPLEMENT.** Không có bất kỳ header `Idempotency-Key` nào được đọc/kiểm tra ở 2 endpoint này. Rủi ro thật: nếu FE double-click hoặc network lag retry, `publishArticle` có thể gọi `WordPressService.pushToWordPress` 2 lần cho cùng 1 bài trước khi `article.status` kịp cập nhật `POSTED_WP` (race condition — không có lock ở tầng document).

Đề xuất cho `coder-agent`:
1. Thêm decorator đọc header `Idempotency-Key` (bắt buộc với `publishArticle`/`publishBulkArticles`).
2. Lưu key đã xử lý (VD: field `idempotencyKey` unique index trên `NewsArticle`, hoặc collection riêng `idempotency_keys` với TTL index) để chặn request trùng trong khoảng thời gian ngắn.
3. Cách rẻ hơn nếu không muốn thêm collection: check `article.status.includes(POSTED_WP)` trước khi gọi WordPress (guard đã có ở `publishToWordPress()` trong service — nhưng đây chỉ chống gọi lại sau khi đã xong, KHÔNG chống 2 request chạy đồng thời trước khi document được lưu lần đầu). Vẫn nên có Idempotency-Key thật để chống race condition.

### 2.3 Endpoint khác cần lưu ý

- `GET articles` (L286) chỉ nhận query `date`, **chưa có param `status`** để filter `CRAWLED`/`POSTED_WP`/`ERROR` — trong khi FE (`ManageWpScreen.tsx`) đã giả định có filter này (xem mục 4, `NEWS_MODULE_DATA_MODEL.md`). Cần bổ sung `@Query('status')` nếu muốn đúng plan gốc.
- `POST raw-articles/move-bulk` (`moveRawArticlesBulk`, L131): xem GAP Transaction ở mục 4.1 dưới đây — đây là API rủi ro mất dữ liệu cao nhất trong module.

---

## 3. Service Architecture

Module chia Service theo Single Responsibility, đăng ký tại `news-fire-crawl-manager.module.ts`. Danh sách thật (khác thiết kế cũ ở vài điểm quan trọng):

- **`NewsFireCrawlManagerController`**: nhận request, validate DTO, gọi Service tương ứng. ⚠️ Xem GAP DRY ở mục 4.5.
- **`NewsSourceService`** + **`NewsSourceController`** (route riêng): CRUD `NewsSource`. ⚠️ Hard delete, không filter `deletedAt` (xem data model doc mục 2).
- **`CustomCrawlerService`** (KHÔNG phải `FirecrawlService`): đây là service crawl thật đang chạy. `FirecrawlService` (`firecrawl.service.ts`) **toàn bộ nội dung đã bị comment-out** — chỉ còn code chết, không được inject vào module (không có trong `providers`). Crawl thật dùng `axios` + `cheerio` (scrape HTML) và `rss-parser` (nếu `NewsSource.rssUrl` có giá trị), timeout `30000ms` đã cấu hình cho cả 2 nhánh request (đúng quy chuẩn Timeout). Không thấy cấu hình Retry/Exponential Backoff ở tầng gọi `axios` — ⚠️ GAP nhẹ, nên bổ sung nếu nguồn tin hay timeout.
- **`AIFilterService`**: gọi AI Provider (OpenRouter ưu tiên, fallback Gemini qua `@google/genai`). Không thấy timeout riêng cấu hình cho lệnh gọi AI (không giống Firecrawl có `timeout: 30000`) — ⚠️ GAP nhẹ, cân nhắc bổ sung timeout tường minh cho request AI vì response có thể lâu.
- **`NewsArticleService`**: thao tác chính trên `NewsArticle`, sinh `urlHash` (SHA-256 nếu chưa có sẵn — xem cảnh báo hash không nhất quán ở data model doc mục 3), publish sang WordPress, xóa bulk. ⚠️ Hard delete (`deleteMany`), xem mục 4.1/4.2.
- **`WordPressService`**: ⚠️ **GAP nghiêm trọng — đây là service MOCK, chưa gọi WordPress thật.** Verify `wordpress.service.ts`: `pushToWordPress()` chỉ `await new Promise(setTimeout 1000ms)` rồi trả `Math.floor(Math.random() * 100000) + 1` làm `wpPostId`. Không có HTTP request thật, không Timeout/Retry/Circuit Breaker thật (vì chưa có network call để cấu hình). **Trước khi go-live tính năng publish, `coder-agent` phải implement gọi WordPress REST API thật**, kèm Timeout (đề xuất 15s) + Retry/Exponential Backoff theo đúng quy chuẩn — hiện các "luật thép" trong thiết kế cũ mô tả cho service này đều chưa có gì để áp dụng vì chưa có lệnh gọi thật.
- **`CronjobService`**: xem mục 3.1 riêng dưới đây — thiết kế cũ claim sai về Redis lock.
- **`AiPromptConfigService`**: quản lý prompt AI (đọc/ghi, không thuộc phạm vi audit lần này).

### 3.1 CronjobService — sửa lại đúng thực tế

Thiết kế cũ: *"Đảm bảo có Redis/Distributed Lock để không chạy đè 2 job cùng lúc."* Verify `cronjob.service.ts`:

**⚠️ Thực tế: KHÔNG có Redis, KHÔNG có Distributed Lock nào cả.** Cơ chế thật:
- Dùng `@nestjs/schedule` (`SchedulerRegistry`) + package `cron` (`CronJob`) — thuần in-process, không có state bên ngoài.
- Config (`isActive`, `frequency`) lưu trong **biến instance của class** (`private isActive`, `private frequency`), **không persist xuống DB** → mất config mỗi lần restart server, và **không đồng bộ giữa nhiều instance** nếu chạy multi-instance.
- Job chạy 1 lần trong tiến trình hiện tại (`schedulerRegistry.addCronJob`), không có cơ chế khóa liên-tiến-trình.

**Rủi ro thật khi scale:** Nếu deploy nhiều instance backend (horizontal scaling, VD: 2+ pod K8s hoặc PM2 cluster mode), **mỗi instance sẽ tự chạy cron job độc lập theo đúng `frequency` đã set** → `executeCrawlFlow()` chạy đồng thời N lần (N = số instance) tại cùng thời điểm, gây: crawl trùng lặp tốn quota AI/3rd-party, ghi dữ liệu race condition (dù có `unique: true` trên `urlHash` nên không tạo trùng dữ liệu, nhưng tốn tài nguyên và log gây khó debug).

Đề xuất path nâng cấp (chỉ áp dụng khi thực sự chuyển sang multi-instance, tránh over-engineering nếu hiện tại chạy single-instance):
1. **Ngắn hạn, rẻ nhất**: dùng MongoDB làm distributed lock — 1 document duy nhất (VD: `system_locks` collection) với `findOneAndUpdate` có điều kiện `{ lockedUntil: { $lt: now } }`, TTL index tự nhả lock nếu process chết. Không cần thêm Redis.
2. **Dài hạn, nếu đã có Redis cho cache/session khác**: dùng `redlock` hoặc annotate qua BullMQ repeatable job (BullMQ tự đảm bảo 1 worker xử lý 1 job tại 1 thời điểm nhờ Redis).
3. Đồng thời nên persist `isActive`/`frequency` xuống DB (VD: `Settings` collection đã có sẵn ở module `settings`) để cấu hình không mất khi restart.

---

## 4. Cross-cutting Concerns

Mục này liệt kê các concern kiến trúc bậc cao theo quy chuẩn Enterprise/Kiến trúc phân tán, đối chiếu hiện trạng thật của module. **Đây là các GAP thực tế cần xử lý, không phải mô tả tính năng đã hoàn thiện.**

### 4.1 Transaction (`ClientSession`) — GAP

Quy chuẩn: update từ 2 collection trở lên bắt buộc dùng `ClientSession` Transaction.

**⚠️ GAP xác nhận tại `moveRawArticlesBulk()`** (`news-fire-crawl-manager.controller.ts` L131-161). Luồng thật:
1. `customCrawlerService.getRawArticlesByIds(ids)` — đọc từ `raw_articles`.
2. `newsArticleService.saveArticles(rawArticles)` — **write vào `news_articles`**.
3. `customCrawlerService.deleteRawArticlesBulk(successfulIds)` — **write (hard delete) vào `raw_articles`**.

Bước 2 và bước 3 là 2 write riêng biệt trên 2 collection khác nhau, **không nằm trong cùng 1 `ClientSession`**. Nếu server crash/lỗi network giữa bước 2 và bước 3 (VD: sau khi `saveArticles` đã insert xong vào `news_articles` nhưng trước khi `deleteRawArticlesBulk` chạy), dữ liệu sẽ **tồn tại đồng thời ở cả `raw_articles` và `news_articles`** — không mất dữ liệu nhưng có nguy cơ trùng lặp hiển thị / xử lý lại. Ngược lại nếu `saveArticles` lỗi giữa vòng lặp (throw ở 1 article) — hàm này tự bắt lỗi từng item nên ít rủi ro hơn, nhưng tổng thể vẫn thiếu tính atomic giữa 2 collection.

Đề xuất: bọc bước 2 + bước 3 trong `session.withTransaction()` (yêu cầu MongoDB chạy Replica Set — cần xác nhận môi trường deploy hiện tại có Replica Set hay Standalone trước khi áp dụng, nếu Standalone phải chuyển sang Replica Set trước).

### 4.2 Audit Trail — GAP

Quy chuẩn: mọi hành động Create/Update/Delete dữ liệu quan trọng phải ghi log vào collection riêng (ai làm, lúc nào, thay đổi gì).

**⚠️ GAP toàn phần — không có collection Audit Trail nào trong module.** Không có middleware/interceptor nào ghi log hành động Create/Update/Delete. Rủi ro rõ nhất: kết hợp với GAP hard-delete (mục 6, data model doc) — khi user bulk-delete nhầm (`deleteBulkArticles`, `deleteRawArticlesBulk`), dữ liệu mất vĩnh viễn và **không có log nào để biết ai xóa, lúc nào, xóa cái gì** để điều tra/khôi phục thủ công.

Đề xuất: thêm collection `audit_logs` (fields tối thiểu: `action`, `collectionName`, `documentId`, `userId`/`actor`, `changes` (diff hoặc snapshot before/after), `createdAt`), ghi log tối thiểu ở các thao tác Delete/Bulk-Delete/Publish trước — đây là action rủi ro cao nhất, không cần audit toàn bộ Read.

### 4.3 Correlation ID (X-Request-ID) — GAP

Quy chuẩn: Frontend sinh `X-Request-ID`, Backend đính vào mọi dòng log.

**⚠️ GAP toàn phần.** Verify `main.ts` và `GlobalExceptionFilter`: không có middleware nào đọc/sinh header `X-Request-ID`, `Logger` (built-in NestJS `Logger`, dùng trực tiếp trong Controller/Service qua `new Logger(ClassName.name)`) không đính kèm request ID vào log. Khi lỗi xảy ra ở luồng nhiều bước (VD: cron flow gọi Crawl → AI Filter → Save), không có cách nào nối các dòng log lại thành 1 trace duy nhất.

Đề xuất: thêm middleware ở `main.ts` (hoặc `NestMiddleware` riêng) đọc header `X-Request-ID` (sinh mới bằng `crypto.randomUUID()` nếu FE không gửi), gắn vào `request` object và dùng `AsyncLocalStorage` hoặc context binding để mọi `Logger.log`/`error` trong request đó tự đính kèm ID — hoặc đơn giản hơn, truyền ID qua tham số vào các Service method quan trọng (crawl flow, publish flow) và log tường minh.

### 4.4 Health Check — ĐÃ CÓ, kế thừa nguyên trạng

✅ **Đã có `/health/liveness` và `/health/readiness`** qua `@nestjs/terminus`, verify `HealthModule` (`health.module.ts`) và `HealthController` (`health.controller.ts`): `liveness` check rỗng (chỉ xác nhận process sống), `readiness` check `MongooseHealthIndicator.pingCheck('database')` (xác nhận kết nối MongoDB sống). Đúng chuẩn Enterprise, **không cần tạo thêm health check riêng cho module NewsFireCrawlManager** — kế thừa health check chung ở tầng `AppModule`.

### 4.5 Error Handling — ĐÃ CÓ GlobalExceptionFilter, nhưng vi phạm DRY ở Controller

✅ `GlobalExceptionFilter` đã đăng ký global (`app.useGlobalFilters(new GlobalExceptionFilter())` trong `main.ts`), format lỗi chuẩn `{ statusCode, message, timestamp, path }` — đúng quy chuẩn.

**⚠️ GAP DRY — Controller tự try/catch lặp lại ở toàn bộ 17 method.** Verify `news-fire-crawl-manager.controller.ts`: mọi method (từ `getPrompts` đến `cleanArticle`) đều bọc `try { ... } catch (error: any) { this.logger.error(...); throw new InternalServerErrorException(...) }` theo cùng 1 pattern lặp lại gần như y hệt. Vì `GlobalExceptionFilter` đã xử lý mọi exception ném ra (kể cả lỗi không bắt), phần lớn các block try/catch này **thừa** — chúng chỉ làm 2 việc: log lỗi, và che lỗi gốc bằng `InternalServerErrorException` (làm mất status code gốc nếu lỗi ban đầu không phải 500, dù vài nơi đã cẩn thận `if (error instanceof HttpException) throw error` để giữ lại — nhưng không nhất quán giữa các method, một số method thiếu check này, VD `getPrompts` không có try/catch nhưng `getCronConfig`... một số có, không đồng nhất).

Đề xuất cho `coder-agent`:
1. Bỏ try/catch lặp ở Controller, để lỗi tự bay lên `GlobalExceptionFilter`.
2. Nếu cần log riêng theo Controller (khác với log lỗi chung), chuyển sang dùng `Interceptor` chung (VD: `LoggingInterceptor` áp global hoặc theo Controller) thay vì lặp code trong từng method — đúng SRP/DRY.
3. Nếu cần giữ lại 1 số logic đặc thù (VD: cleanup file tmp ở `analyzeManual`/`triggerManualAnalyze` dùng `finally`), giữ nguyên `finally` đó (không phải lỗi, là cleanup hợp lệ) nhưng tách phần catch/rethrow ra khỏi pattern chung.

### 4.6 Cache (Redis), Rate Limit

Không thấy nhu cầu rõ ràng trong code hiện tại (chưa có API GET nào bị đánh giá là "truy vấn nặng" cần cache, traffic module này là nội bộ/admin, không public). **Không đề xuất thêm Redis Cache/RateLimit cho module này ở giai đoạn hiện tại** — tránh over-engineering. Cân nhắc lại nếu traffic tăng hoặc mở endpoint crawl-trigger ra ngoài phạm vi admin nội bộ.

---

## 5. Frontend & Screens

Giữ nguyên tinh thần thiết kế cũ ở mức tổng quan (chi tiết cột/dropdown cụ thể để ở spec riêng của từng screen nếu cần):

- **RawArticlesScreen**: hiển thị `RawArticle` dạng Table, hỗ trợ search, sort, filter theo khoảng ngày, Bulk Actions (Delete, Move sang News Article). Format ngày `DD/MM/YYYY`.
- **ManageWpScreen**: hiển thị `NewsArticle` dạng Table, filter theo `status` (⚠️ hiện BE chưa expose param `status` ở `GET articles` — xem mục 2.3, cần bổ sung để filter hoạt động đúng), Bulk Actions (Delete, Publish to WordPress).

Quy tắc quản lý state áp dụng theo `nodejs-react-mongo-coding-guidelines`: state cục bộ (mở/đóng dialog, giá trị input) dùng `useState`; state liên quan API (danh sách bài viết, trạng thái crawl/cron) nên chuyển sang **React Query** nếu hiện đang dùng `useEffect` gọi API trực tiếp (chưa audit sâu phần FE trong lần này — nếu `coder-agent` phát hiện còn `useEffect` fetch thủ công, phải refactor sang React Query theo đúng quy chuẩn bắt buộc).

---

## Tổng kết GAP cần xử lý (ưu tiên gợi ý, không bắt buộc theo thứ tự)

| # | Gap | Rủi ro | Vị trí |
|---|---|---|---|
| 1 | WordPressService là mock, chưa gọi API thật | Tính năng publish không hoạt động thật trong production | `wordpress.service.ts` |
| 2 | Không có Transaction ở Bulk Move | Dữ liệu trùng/kẹt giữa 2 collection nếu crash giữa luồng | `moveRawArticlesBulk()` |
| 3 | Không có Idempotency-Key ở publish | Đăng đúp bài lên WordPress khi double-click/network lag | `publishArticle`, `publishBulkArticles` |
| 4 | Hard delete toàn bộ, không có `deletedAt` | Mất dữ liệu vĩnh viễn khi xóa nhầm, không khôi phục được | Cả 3 collection — xem `NEWS_MODULE_DATA_MODEL.md` mục 6 |
| 5 | Không có Audit Trail | Không tra được ai/khi nào xóa/publish dữ liệu | Toàn module |
| 6 | Không có Correlation ID | Khó trace log xuyên nhiều Service trong 1 luồng | Toàn module |
| 7 | CronjobService không có Distributed Lock (khác doc cũ claim) | Double-run nếu scale multi-instance; mất config khi restart (không persist DB) | `cronjob.service.ts` |
| 8 | Controller try/catch lặp lại, vi phạm DRY | Khó maintain, không nhất quán status code lỗi | `news-fire-crawl-manager.controller.ts` |
| 9 | Response List thiếu `meta`/phân trang | List sẽ chậm/nặng khi dữ liệu lớn dần | `getRawArticles`, `getArticles` |
| 10 | Retry/Backoff chưa có ở crawl (axios) và AI call | Job thất bại toàn phần khi 3rd-party chập chờn tạm thời | `custom-crawler.service.ts`, `ai-filter.service.ts` |
