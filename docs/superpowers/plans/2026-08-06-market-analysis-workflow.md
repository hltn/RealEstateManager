# Market Analysis Workflow Orchestration — Project Plan

**Date:** 2026-08-06
**Author:** PM Agent
**Status:** Draft

---

## 1. Scope

### Mục tiêu nghiệp vụ

Gom 5 bước xử lý dữ liệu thị trường hiện có (đang chạy rời rạc, thủ công từng bước) thành **1 pipeline tự động**, người dùng chỉ cần chọn ngày và nhấn 1 nút "Phân tích". Hệ thống tự chạy tuần tự 5 bước, người dùng có thể theo dõi tiến độ real-time, đóng tab rồi quay lại vẫn thấy trạng thái. Kết quả cuối cùng hiển thị phân tích thị trường đã lưu + lịch sử các lần chạy trước.

### In-scope

| # | Mục | Mô tả |
|---|-----|-------|
| 1 | **BE Orchestration Endpoint** | Endpoint mới `POST /news-manager/market-analysis-workflow` nhận `date` (optional), tạo 1 jobId tổng, chạy tuần tự 5 bước backend-to-backend, cập nhật `currentStep` (1-5) + `stepStatus` (pending/running/done/error) vào job state. Poll: `GET /news-manager/market-analysis-workflow/:jobId`. |
| 2 | **FE Tab mới "Phân tích thị trường"** | Thêm mục side navigation trong `AppSidebar.tsx`, route mới, component màn hình mới. |
| 3 | **FE Workflow UI** | 1 nút "Phân tích" + 1 input chọn ngày (mặc định hôm nay). Bên dưới: 5-step workflow visualization (step hiện tại có loading spinner + highlight màu). Khi hoàn tất: hiển thị kết quả phân tích từ `MarketAnalysisHistory`. Dưới cùng: danh sách các lần phân tích trước. |
| 4 | **FE Job Provider** | `MarketAnalysisWorkflowJobContext` (pattern giống `ManualCrawlJobContext`/`MarketAnalysisJobContext`): poll 3s, survive tab-switch/refresh, cập nhật trạng thái từng step. |

### Out-of-scope

- Thay đổi logic 5 endpoint hiện có (chỉ gọi lại, không sửa)
- Chạy song song các bước (yêu cầu tuần tự)
- Retry tự động từng bước khi lỗi (MVP: dừng pipeline, báo lỗi)
- WebSocket/SSE real-time push (dùng poll như pattern hiện tại)
- Thay đổi cron flow hiện có

---

## 2. Feature Breakdown

### 2.1 Backend — Orchestration Endpoint

**Agent:** Architect → Coder Backend

**Mô tả:** Tạo 1 endpoint mới trong `news-fire-crawl-manager.controller.ts`, đóng vai trò orchestrator gọi tuần tự 5 endpoint/service hiện có. Tái dụng toàn bộ pattern: `AnalyzeJobService`, `IdempotencyService`, `runJob`/`runLockedJob`.

**Work items:**

| ID | Item | Mô tả | Deps |
|----|------|-------|------|
| BE-1 | **Define WorkflowJobState interface** | Mở rộng job state trong `AnalyzeJobService` (hoặc tạo type riêng) để chứa `currentStep: 1-5`, `steps: [{step, status, result?, error?}]`. Không đụng code hiện có — chỉ thêm type mới hoặc nest trong `result` field. | — |
| BE-2 | **Implement `POST /news-manager/market-analysis-workflow`** | Nhận `{ date?: string }`. Tạo `jobId` qua `AnalyzeJobService.createJob()`. Set `currentStep=0`, `steps=[]`. Fire-and-forget gọi `runWorkflow(jobId, date)`. Trả `{ jobId }`. Lock key: `workflow:market-analysis` (chống double-submit). | BE-1 |
| BE-3 | **Implement `runWorkflow` private method** | Gọi tuần tự 5 bước, mỗi bước: cập nhật `currentStep` + `steps[i].status='running'`, gọi service tương ứng, await kết quả, cập nhật `steps[i].status='done'` + `result`. Nếu lỗi: `steps[i].status='error'` + `error`, dừng pipeline, gọi `markError`. Hoàn tất: `markDone` với full steps result. **Input bước sau lấy từ output bước trước** (vd: bước 3 cần danh sách article IDs đã lọc từ bước 2). | BE-2 |
| BE-4 | **Implement `GET /news-manager/market-analysis-workflow/:jobId`** | Poll endpoint: `analyzeJobService.getJob(jobId)`, trả `{ status, currentStep, steps }` hoặc `{ status: 'not_found' }`. | BE-1 |
| BE-5 | **Unit tests cho orchestration endpoint** | Test: POST trả jobId, lock conflict 409, poll trả step progression, pipeline success full 5 steps, pipeline error dừng đúng step. Mock toàn bộ service dependencies. | BE-2, BE-3, BE-4 |

**5 bước pipeline — mapping endpoint hiện có:**

| Step | Tên hiển thị | Gọi service/endpoint | Output cần cho bước sau |
|------|-------------|---------------------|------------------------|
| 1 | Thu thập tin tức | `customCrawlerService.crawlData(date)` → raw_articles | `{ count, filePath }` |
| 2 | Phân tích & lọc | `analyzeRawArticles()` (logic từ POST /analyze-raw) | Danh sách raw_article IDs đã qua lọc |
| 3 | Chuyển sang bài viết | `moveArticlesBulk(filteredIds)` (logic từ POST /raw-articles/move-bulk) | Danh sách news_article IDs đã tạo |
| 4 | Crawl nội dung chi tiết | `marketAnalysisBulk(articleIds)` (logic từ POST /articles/market-analysis-bulk) | Articles đã có content |
| 5 | Phân tích thị trường | `analyzeMarketTrends()` (logic từ POST /articles/analyze-market-trends) | `MarketAnalysisHistory` record |

### 2.2 Frontend — Tab + Workflow UI

**Agent:** Architect → Coder Frontend

**Mô tả:** Tab mới "Phân tích thị trường" trong side navigation, giao diện workflow 5 bước với real-time status, lịch sử phân tích.

**Work items:**

| ID | Item | Mô tả | Deps |
|----|------|-------|------|
| FE-1 | **Thêm route + side nav entry** | Thêm `MarketAnalysisWorkflowScreen` route trong router config. Thêm mục "Phân tích thị trường" trong `AppSidebar.tsx` (icon phù hợp, vị trí sau mục "Phân tích tin tức" hiện tại). | — |
| FE-2 | **Tạo `MarketAnalysisWorkflowJobContext.tsx`** | Pattern giống `MarketAnalysisJobContext.tsx` / `ManualCrawlJobContext.tsx`. Poll `GET /news-manager/market-analysis-workflow/:jobId` mỗi 3s khi `status === 'pending'`. Expose: `startJob(date)`, `jobState: { currentStep, steps }`, `isRunning`. Provider bọc trong `AppLayout.tsx`. | — |
| FE-3 | **Xây dựng UI màn hình chính** | Layout: (1) Row trên: input date (DatePicker, mặc định hôm nay) + nút "Phân tích" (disabled khi đang chạy). (2) Workflow visualization: 5 step cards nối bằng arrow/connector, step hiện tại có spinner + màu highlight (xanh lam), step done có check + màu xanh lá, step error có X + màu đỏ, step pending màu xám. (3) Kết quả: khi done → hiển thị nội dung `MarketAnalysisHistory.content` (render markdown/text). (4) Lịch sử: table/list các lần phân tích trước (gọi API list `MarketAnalysisHistory`, sorted by createdAt DESC). | FE-2 |
| FE-4 | **Xử lý edge cases** | (a) User tắt tab khi job đang chạy → mở lại vẫn thấy progress (provider sống ở AppLayout). (b) Lock conflict 409 → toast "Đang có phân tích đang chạy". (c) Server restart → `not_found` → toast lỗi, reset UI. (d) Step lỗi → hiển thị step đó màu đỏ + error message, nút "Chạy lại" reset form. | FE-3 |
| FE-5 | **Gọi API lịch sử phân tích** | Dùng TanStack Query `useQuery` để fetch danh sách `MarketAnalysisHistory`. Query key: `['market-analysis-history']`. Hiển thị: ngày tạo, số bài viết, preview content (100 chars). Click vào 1 row → hiển thị full content bên trên. | FE-3 |

---

## 3. Milestone

### M-1: MVP (Backend Orchestration + FE Cơ bản)

**Mục tiêu:** Pipeline 5 bước chạy được end-to-end, UI hiển thị trạng thái, người dùng có thể bắt đầu 1 phân tích và xem kết quả.

| Work items | BE-1, BE-2, BE-3, BE-4, FE-1, FE-2, FE-3 |
|------------|--------------------------------------------|
| **Definition of Done** | |
| BE | POST workflow → jobId, poll → thấy step progression 1→5, pipeline chạy đến bước 5 và `markDone`. Unit tests pass. |
| FE | Tab mới hiển thị trong sidebar, chọn ngày + nhấn "Phân tích" → UI hiển thị 5 step cards với step hiện tại loading, step done check, kết thúc hiển thị kết quả phân tích. |
| Integration | End-to-end: nhấn nút → 5 bước chạy tuần tự → kết quả hiển thị. Survive tab-switch (đóng mở tab vẫn thấy progress). |

### M-2: Enhancement (Lịch sử + Edge Cases + Polish)

**Mục tiêu:** Hoàn thiện UX: lịch sử phân tích, xử lý lỗi graceful, UI polish.

| Work items | BE-5, FE-4, FE-5 |
|------------|-------------------|
| **Definition of Done** | |
| FE | Danh sách lịch sử phân tích hiển thị dưới cùng, click xem lại. Xử lý đúng: lock conflict, server restart, step error. |
| BE | Unit test coverage cho orchestration endpoint (success, lock conflict, step error, not_found). |
| QA | `qa-agent` review toàn bộ: error handling, naming convention, responsive UI, không regression. |

### M-3: Enterprise Hardening (Tùy chọn, ngoài MVP)

| Item | Mô tả |
|------|-------|
| Audit log | Ghi audit mỗi lần workflow start + complete/error (tái dùng `AuditLogService`) |
| Rate limit | Thêm rate limit cho workflow endpoint (tránh abuse AI cost) |
| Retry step | Cho phép retry từ step lỗi thay vì chạy lại từ đầu |

---

## 4. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Firecrawl API rate limit** (bước 1+4) | Pipeline bị kẹt giữa chừng | Step error → dừng pipeline, hiển thị lỗi rõ ràng cho user. Có thể chạy lại sau. |
| **WordPress API timeout** (bước 4) | Tương tự trên | Timeout config hợp lý, catch error từng step. |
| **In-memory job state mất khi server restart** | Job đang chạy biến mất, FE poll → `not_found` | Pattern hiện tại đã xử lý: FE hiển thị lỗi "Không tìm thấy job". User chạy lại. |
| **5 bước chạy lâu (5-15 phút)** | User phải đợi | Poll 3s, UI hiển thị rõ step hiện tại. User có thể rời tab, quay lại sau. |
| **Input bước sau phụ thuộc output bước trước** | Sai logic → pipeline sai | Architect cần xác định chính xác data flow giữa các bước (vd: bước 2 lọc raw_articles → bước 3 cần những ID nào). |
| **Lock conflict giữa workflow và manual crawl riêng lẻ** | User gọi workflow trong khi đang crawl thủ công | Dùng lock key riêng `workflow:market-analysis`, không share với `crawl:global`. Tuy nhiên bước 1 bên trong workflow gọi `crawlData` → có thể đụng lock `crawl:global`. Cần quyết định: workflow có dùng lock riêng hoàn toàn, hay tái dụng lock của từng bước? → Architect quyết định. |

---

## 5. Open Questions (cho Architect)

1. **Data flow giữa các bước:** Bước 2 (analyze-raw) trả về gì? Bước 3 (move-bulk) cần input gì? Bước 4 (market-analysis-bulk) cần những article ID nào? Cần architect xác nhận schema input/output từng bước để implement `runWorkflow`.

2. **Lock strategy:** Workflow nên dùng lock riêng (`workflow:market-analysis`) hay tái dụng lock của từng bước thành phần? Nếu dùng lock riêng, có nguy cơ conflict với manual crawl đang chạy? Nếu tái dụng, làm sao tránh deadlock?

3. **MarketAnalysisHistory API:** Đã có endpoint GET list `MarketAnalysisHistory` chưa? Nếu chưa, cần thêm endpoint mới (FE-5 phụ thuộc vào việc này).

4. **Reuse vs re-implement:** Có nên gọi trực tiếp service method (dependency injection) thay vì HTTP call nội bộ giữa các bước? Pattern hiện tại: controller method gọi private method → nên làm tương tự (gọi thẳng service, không HTTP).

---

## 6. Agent Handoff

Sau khi plan được approve, thứ tự thực hiện:

```
pm-agent (plan này) → architect-agent (quyết định data flow, lock strategy, API schema)
    → coder-backend-agent (BE-1 → BE-5)
    → coder-frontend-agent (FE-1 → FE-5)
    → qa-agent (review + audit)
```