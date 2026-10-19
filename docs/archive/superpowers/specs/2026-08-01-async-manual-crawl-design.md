# Async Manual Crawl — Design Spec

**Date:** 2026-08-01
**Feature:** Chạy quy trình thu thập (manual crawl) bất đồng bộ + status trên header
**Status:** Approved (pending user spec review)

## Mục tiêu

Chuyển chức năng "Chạy quy trình thu thập" (nút ở `RawArticlesScreen`) từ đồng bộ sang bất đồng bộ, mirror pattern "phân tích tin tức" (analyze market trends): request trả ngay `{ jobId }`, job chạy nền, FE poll status, header hiển thị pill trạng thái.

## Phạm vi

- **In:** Manual crawl (`POST /news-manager/crawl`) — async hóa + poll endpoint + FE provider + badge.
- **Out:** Cron flow (`cronjob.service.ts executeCrawlFlow`) — không đụng. Bulk crawl endpoint (`market-analysis-bulk`) logic giữ nguyên.

## Quyết định thiết kế (đã chốt với user)

1. **Mức độ status:** `pending → done → error` (giống y analyze). Không có progress theo nguồn. Khi `done`: reload danh sách `raw-articles` + toast số bài crawl được (lấy từ job result).
2. **Badge:** Dùng chung `CrawlStatusBadge` với bulk crawl. Share lock key `crawl:global` → manual và bulk không chạy chồng nhau (chạy đè → ConflictException 409).
3. **Hướng kiến trúc A:** Tái dụng `AnalyzeJobService` (generic in-memory) + helper `runLockedJob`/`runJob` hiện có, thêm provider FE riêng theo convention "1 provider/job type".

## Kiến trúc & luồng dữ liệu

```
RawArticlesScreen                Backend (news-fire-crawl-manager)
─────────────────               ───────────────────────────────
[Chạy quy trình thu thập]
   │ POST /news-manager/crawl (body: dateRange)
   ▼
   triggerManualCrawl()
   ├─ idempotency.markInFlight("crawl:global")  → trùng → ConflictException 409
   ├─ jobId = analyzeJobService.createJob()        (status: pending)
   ├─ void runLockedJob(jobId, work, "crawl:global")  ← fire-and-forget
   └─ return { message: "Crawl started", jobId }  ← HTTP 200 trả ngay

            (FE nhận jobId)
            │ startJob(jobId) → setCrawlStatus("pending") + poll 3s
            ▼
            GET /news-manager/crawl/:jobId  ──►  analyzeJobService.getJob(jobId)
                                                  → { status, result?, error? } | not_found

   (nền) work = customCrawlerService.crawlData(...)
           ├─ success → markDone(jobId, { stats, count, filePath })
           └─ error   → markError(jobId, msg)
   (runLockedJob finally luôn clearInFlight("crawl:global"))

   (FE poll) status=done  → setCrawlStatus("done") + invalidate ["raw-articles"] + toast count
             status=error → setCrawlStatus("error", msg) + toast
             not_found    → setCrawlStatus("error", "Không tìm thấy job (có thể server đã khởi động lại)")
```

Job state lưu in-memory (`AnalyzeJobService`, Map, TTL 1h). Backend restart = mất job → FE xử lý `not_found` thành error.

## Thay đổi Backend

### `news-fire-crawl-manager.controller.ts`

**1. `triggerManualCrawl(@Body() body: TriggerManualCrawlDto)` (line ~249-269) — đổi sang async:**
- Xóa await `customCrawlerService.crawlData(...)` và `fs.readFileSync` đồng bộ.
- Áp khuôn `analyzeMarketTrends` (line ~545-573):
  - `const lockKey = "crawl:global"`
  - `if (idempotencyService.isInFlight(lockKey)) throw new ConflictException("Đang có tác vụ thu thập đang chạy")`
  - `idempotencyService.markInFlight(lockKey)`
  - `const jobId = analyzeJobService.createJob()`
  - Parse args (dateRange) từ body trước khi fire-and-forget.
  - `void runLockedJob(jobId, () => customCrawlerService.crawlData(...args), lockKey)`
  - `return { message: "Crawl started", jobId }`
- **Work callback:** bao gồm cả việc đọc file kết quả (nếu controller trước đó phụ trách `fs.readFileSync` sau khi `crawlData` ghi file). Kết quả `{ stats, count, filePath }` truyền vào `markDone`. Coder-backend xác nhận ai phụ trách ghi/đọc file khi explore kỹ `customCrawlerService.crawlData`.
- **Audit log:** thêm `auditLogService.log({ action: "manual-crawl", jobId, ... })` theo pattern `market-analysis-bulk` (line ~637), try/catch không break main.

**2. `runLockedJob`/`runJob` (line ~687-730) — giữ nguyên, tái dùng.** `markDone(jobId, result)` nhận `result = { stats, count, filePath }`.

**3. Thêm endpoint poll:**
- `GET /news-manager/crawl/:jobId` → `analyzeJobService.getJob(jobId)`, trả `{ status: "not_found" }` nếu hết TTL/restart.
- Copy khuôn endpoint status của `analyzeMarketTrends` (line ~594-608).
- Swagger: `@ApiOperation({ summary: "Crawl status (async)" })`, tag phù hợp.

**4. DTO:** `TriggerManualCrawlDto` giữ nguyên (body shape không đổi). Response shape đổi: từ `{ message, filePath, stats, data }` → `{ message, jobId }`.

## Thay đổi Frontend

### Thêm `src/context/ManualCrawlJobContext.tsx`
Copy khuôn `BulkCrawlJobContext.tsx`:
- `ManualCrawlJobResponse`: `{ status: "pending"|"done"|"error"|"not_found"; result?: { stats?; count?; filePath? }; error? }`
- `startJob(jobId: string)` → `setCrawlStatus("pending")` + `setJobId`
- React Query `useQuery` queryKey `["manual-crawl-job", jobId]`, queryFn `GET /news-manager/crawl/${jobId}`, `refetchInterval` 3s khi `pending`/`undefined`.
- `done` → `setCrawlStatus("done")` + `invalidateQueries({ queryKey: ["raw-articles"] })`. Không toast ở provider — để screen watcher xử lý count.
- `error` → `setCrawlStatus("error", msg)`
- `not_found` → `setCrawlStatus("error", "Không tìm thấy job (có thể server đã khởi động lại)")`
- Polling error (sau retry) → `setCrawlStatus("error", ...)`

### `AppLayout.tsx` (line ~40)
- Thêm `<ManualCrawlJobProvider>` sau `<BulkCrawlJobProvider>`.

### `RawArticlesScreen.tsx` (line 156-183, 391-397)
- `crawlMutation`: `POST /news-manager/crawl` → nhận `{ jobId }`, gọi `useManualCrawlJob().startJob(jobId)`.
- Bỏ logic dùng `articles`/`stats` trả về đồng bộ (không còn).
- Watcher (qua `useQuery` watch `["manual-crawl-job", jobId]` hoặc `useManageWpStatus().crawlStatus`):
  - `done` + `result.count` → `setSuccess("Thu thập hoàn tất — N bài mới")`.
  - `error` → `setError(msg)`.
- Button "Chạy quy trình thu thập":
  - Label "Đang thu thập..." khi `crawlStatus === "pending"` (phản ánh đúng trạng thái nền, đồng bộ với header pill).
  - Disable khi `crawlStatus === "pending"` (giống ManageWpScreen line 645).
- `crawlMutation.onError`: bắt 409 ConflictException → `setError("Đang có lượt thu thập đang chạy, vui lòng đợi")`.

### `AppHeader.tsx`
- `CrawlStatusBadge` (line 274) đã render — giữ nguyên. Đảm bảo badge text/label phục vụ cả manual crawl (nếu text cứng cho bulk thì mở rộng label, nếu generic thì OK). Coder-frontend xác nhận khi sửa.

## Error handling & Edge cases

| Trường hợp | Xử lý |
|---|---|
| Concurrent run (manual + bulk) | lock `crawl:global` → ConflictException 409. FE bắt 409 → toast "Đang có lượt thu thập đang chạy, vui lòng đợi". |
| Backend restart giữa chừng | job in-memory mất → poll `not_found` → `setCrawlStatus("error")`. User biết chạy lại. |
| Crawl throw (AI timeout, network) | `runJob` catch → `markError(jobId, msg)` + `clearInFlight` (finally). FE poll `error` → toast. |
| TTL 1h hết hạn | `not_found` → error. Không nâng TTL. |
| Cron flow | Out of scope, không đụng. Lock riêng của cron (nếu có) tách biệt với `crawl:global`. |

## Testing

### Backend (controller spec)
- `triggerManualCrawl` trả `{ jobId }`, không await `crawlData`.
- ConflictException khi `crawl:global` đang in-flight.
- Poll endpoint trả `not_found` đúng khi job hết TTL.
- `runLockedJob`/`runJob` gọi `markDone`/`markError`/`clearInFlight` đúng.
- Mock: `customCrawlerService.crawlData`, `analyzeJobService`, `idempotencyService`, `auditLogService`.

### Frontend
- `ManualCrawlJobContext` poll logic (mock apiAxios): pending→done invalidate `raw-articles`, error/not_found handling. Theo style test `BulkCrawlJobContext` nếu có.

### QA
- `qa-agent` review full + audit Enterprise (bảo mật, error handling, naming convention) sau khi coder xong (bắt buộc theo CLAUDE.md).

## Tái dùng / không tái dùng

- **Tái dùng:** `AnalyzeJobService`, `IdempotencyService`, `runLockedJob`, `runJob`, `ManageWpStatusContext.setCrawlStatus`, `CrawlStatusBadge`, `AppLayout` provider convention.
- **Không rename** `AnalyzeJobService` (tránh rủi ro chạm code đang chạy — 3 job khác đang dùng).
- **Không đụng** cron flow, bulk crawl logic, analyze endpoints.
