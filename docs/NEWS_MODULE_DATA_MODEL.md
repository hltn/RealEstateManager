# NewsFireCrawlManager — Data Model

  

Tài liệu này mô tả **schema thật** (đã verify trực tiếp từ code tại thời điểm 2026-07-27) của module `news-fire-crawl-manager`. Đây là tài liệu tham chiếu duy nhất cho phần Database — `TECHNICAL_DESIGN.md` không nhắc lại code schema, chỉ trỏ sang file này.

  

Nguồn verify:

- `RealEstateBackendApp/src/modules/news-fire-crawl-manager/schemas/news-source.schema.ts`

- `RealEstateBackendApp/src/modules/news-fire-crawl-manager/schemas/raw-article.schema.ts`

- `RealEstateBackendApp/src/modules/news-fire-crawl-manager/schemas/news-article.schema.ts`

- `RealEstateBackendApp/src/modules/news-fire-crawl-manager/schemas/market-analysis-history.schema.ts` (collection phụ, không nằm trong 3 collection cốt lõi nhưng có thật trong code nên vẫn liệt kê ở mục 8)

  

---

  

## 1. Tổng quan quan hệ (ERD dạng text)

  

```

NewsSource (news_sources)

    │

    │  KHÔNG có liên kết cứng (không có sourceId trong NewsArticle/RawArticle)

    │  Liên kết hiện tại chỉ là liên kết MỀM qua field "source" (string, = NewsSource.name)

    ▼

RawArticle (raw_articles)  ── Bulk Move (không transaction) ──▶  NewsArticle (news_articles)

    (dữ liệu thô, tạm)                                                (dữ liệu chính thức)

                                                                        │

                                                                        │  articleIds: string[]

                                                                        │  (liên kết mềm, không ObjectId ref)

                                                                        ▼

                                                          MarketAnalysisHistory (market_analysis_histories)

```

  

Điểm khác biệt quan trọng so với thiết kế cũ:

- **Không có `NewsSource._id` được tham chiếu ở đâu cả.** `NewsArticle` và `RawArticle` chỉ lưu `source: string` (tên nguồn, copy tại thời điểm crawl), không phải `ObjectId`. Muốn biết một `NewsArticle` thuộc `NewsSource` nào phải so khớp chuỗi `name`, không `.populate()` được.

- `RawArticle → NewsArticle` không phải là quan hệ DB (không FK/ref) — là một **phép biến đổi dữ liệu một lần** (copy field + tính lại `urlHash` nếu chưa có) do `NewsArticleService.saveArticles()` thực hiện, sau đó `RawArticle` gốc bị xóa cứng.

- `MarketAnalysisHistory.articleIds` là `string[]` thô (không phải `Types.ObjectId[]`, không có `ref`), nên cũng không `.populate()` được.

  

→ Đây chính là gap #3 trong audit: thiết kế cũ claim "bắt buộc dùng ObjectId Reference" nhưng thực tế toàn bộ module dùng liên kết mềm bằng string. Xem hướng khắc phục ở `TECHNICAL_DESIGN.md` mục Data Layer.

  

---

  

## 2. Collection: `news_sources` (schema `NewsSource`)

  

| Field           | Type                  |        Required         |       Index       | Note & Giải pháp kỹ thuật                                                                                          |
| :-------------- | :-------------------- | :---------------------: | :---------------: | :----------------------------------------------------------------------------------------------------------------- |
| **name**        | string                |           Có            |       Không       | Tên nguồn tin, map sang `RawArticle.source` / `NewsArticle.source`.                                                |
| **url**         | string                |           Có            |    **Unique**     | URL trang danh sách (listing page). **Cần thêm Unique Index** để tránh admin tạo trùng nguồn crawl.                |
| **isActive**    | boolean               | Không (`default: true`) | **Có (Compound)** | `findActive()` đang full scan! **Bắt buộc đánh Compound Index `{ isActive: 1, deletedAt: 1 }`** để query siêu tốc. |
| **rssUrl**      | string                |          Không          |       Không       | URL RSS ưu tiên parser. Nếu có nên validate chuẩn định dạng URL.                                                   |
| **crawlConfig** | Record\<string, any\> |  Không (`default: {}`)  |       Không       | Config riêng từng nguồn (selector, delay, header...). Cần viết parser handler hoặc tạm ẩn nếu chưa dùng.           |
| **deletedAt**   | Date / null           | Không (`default: null`) |      **Có**       | **BỔ SUNG GAP (Soft Delete):** Đổi sang `Date` (lưu thời điểm xóa, `null` là chưa xóa) để xử lý dốt ráo mục 6.     |
| **createdAt**   | Date                  |          Auto           |       Không       | Chuẩn Mongoose `timestamps: true`.                                                                                 |
| **updatedAt**   | Date                  |          Auto           |      **Có**       | Chuẩn Mongoose `timestamps: true`. Đánh index nếu có job query lọc nguồn mới cập nhật.                             |

  

`NewsSourceService`/`NewsSourceController` thao tác **hard delete** (`findByIdAndDelete`), không có `deletedAt`, không filter theo `deletedAt` ở `findAll()`.

  

---

  

## 3. Collection: `raw_articles` (schema `RawArticle`)

  

| Field                    | Type        | Required |       Index       | Note & Giải pháp kỹ thuật                                                                                                                         |
| :----------------------- | :---------- | :------: | :---------------: | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| **title**                | string      |    Có    |       Không       | Tiêu đề bài viết.                                                                                                                                 |
| **description**          | string      |  Không   |       Không       | Mô tả ngắn / Sapo.                                                                                                                                |
| **content**              | string      |  Không   |       Không       | Nội dung chi tiết. **Lưu ý Phase 1:** Để chuỗi rỗng `''` là chuẩn thiết kế Lazy Loading, đỡ tốn bộ nhớ lưu trữ!                                   |
| **url**                  | string      |    Có    |       Không       | URL tuyệt đối. **Nên dùng `trim: true`** để xóa khoảng trắng thừa.                                                                                |
| **urlHash**              | string      |    Có    |    **Unique**     | Băm SHA-256 (64 hex chars) chống cào trùng bài — đã đồng bộ với `NewsArticle` (trước đây dùng MD5, xem mục 7 migration 002).                        |
| **publishedAt**          | Date        |  Không   | **Có (Compound)** | **SỬA GẤP GAP:** Chuyển từ `string` sang `Date`. Cần đánh Compound Index `{ publishedAt: -1, source: 1 }` để filter theo ngày không bị Full Scan. |
| **thumbnailUrl**         | string      |  Không   |       Không       | Link ảnh đại diện.                                                                                                                                |
| **source**               | string      |    Có    |      **Có**       | Lưu tên nguồn tin (Denormalization). Đánh index để hỗ trợ filter theo nguồn.                                                                      |
| **createdAt, updatedAt** | Date        |   Auto   |       Không       | Chuẩn Mongoose `timestamps: true`.                                                                                                                |
| **deletedAt**            | Date / null |  Không   |      **Có**       | **BỔ SUNG GAP (Soft Delete):** Đổi `deleteMany()` cứng thành Soft Delete để cứu dữ liệu khi trót lỡ tay!                                          |

  

**Nhất quán urlHash (ĐÃ XỬ LÝ):** Toàn bộ module giờ dùng chung `generateUrlHash(url)` (SHA-256, 64 hex) ở `src/common/utils/url-hash.util.ts` cho cả `CustomCrawlerService.crawlData()` và `NewsArticleService.saveArticles()`. Nợ kỹ thuật MD5 cũ (RawArticle sinh MD5, Bulk Move copy MD5 sang NewsArticle) đã được thanh toán bằng migration 002 — xem mục 7 changelog. Không còn 2 thuật toán hash song song.

  

---

  

## 4. Collection: `news_articles` (schema `NewsArticle`)

  

| Field                    | Type            | Required |       Index       | Note & Giải pháp kỹ thuật                                                                                                                                               |
| :----------------------- | :-------------- | :------: | :---------------: | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **title**                | string          |    Có    |       Không       | Tiêu đề bài viết sau khi AI biên tập.                                                                                                                                   |
| **summary**              | string          |  Không   |       Không       | Đoạn tóm tắt bài viết.                                                                                                                                                  |
| **importanceReason**     | string          |  Không   |       Không       | Lý do AI đánh giá độ quan trọng (Job 2).                                                                                                                                |
| **impactLevel**          | string (enum)   |  Không   |      **Có**       | `['Rất cao', 'Cao', 'Trung bình']`. Nên đánh index nếu có tính năng lọc tin hot.                                                                                        |
| **targetAudience**       | string[]        |  Không   |       Không       | Mảng đối tượng độc giả mục tiêu.                                                                                                                                        |
| **expertOpinion**        | string          |  Không   |       Không       | Đánh giá từ chuyên gia do AI tổng hợp.                                                                                                                                  |
| **publishDate**          | Date            |  Không   | **Có (Compound)** | **SỬA GAP GẤP:** Đổi từ `string` -> `Date`. Bắt buộc đánh Compound Index `{ publishDate: -1, createdAt: -1 }` để triệt hạ lỗi Full Scan ở hàm `getSavedArticles(date)`. |
| **thumbnailUrl**         | string          |  Không   |       Không       | Link ảnh đại diện bài viết.                                                                                                                                             |
| **source**               | string          |  Không   |      **Có**       | Tên nguồn tin (Liên kết mềm). Nên đánh index để filter bài theo nguồn.                                                                                                  |
| **url**                  | string          |  Không   |       Không       | Link bài viết gốc.                                                                                                                                                      |
| **keywords**             | string[]        |  Không   |       Không       | Mảng từ khóa SEO / Tags.                                                                                                                                                |
| **urlHash**              | string          |    Có    |    **Unique**     | Băm SHA-256 chống trùng bài (Đồng bộ SHA-256 thay vì dùng MD5).                                                                                                         |
| **wpPostId**             | number / null   |  Không   |  **Có (Sparse)**  | ID bài viết trên WordPress (`default: null`). Đánh **Sparse Index** để tra ngược từ WP ID về DB cực nhanh.                                                              |
| **content**              | string          |  Không   |       Không       | Nội dung chi tiết bài viết.                                                                                                                                             |
| **status**               | string[] (enum) |  Không   | **Có (Multikey)** | Mảng trạng thái `['CRAWLED', 'POSTED_WP', 'ERROR']`. Đánh **Multikey Index** vì API sẽ query lọc tin theo trạng thái liên tục!                                          |
| **createdAt, updatedAt** | Date            |   Auto   |       Không       | Chuẩn Mongoose `timestamps: true`.                                                                                                                                      |
| **deletedAt**            | Date / null     |  Không   |      **Có**       | **BỔ SUNG GAP (Soft Delete):** Đổi Hard Delete thành `deletedAt` để tránh mất dữ liệu khi trót lỡ tay xóa!                                                              |
  

Ghi chú thêm:

- `sourceId` (`Types.ObjectId`, `ref: 'NewsSource'`) **không tồn tại** trong schema thật — toàn bộ mô tả `.populate()` trong thiết kế cũ là aspirational.

- Hiện **không có API param nào cho phép filter theo `status`** ở tầng controller (`GET articles` chỉ nhận `date`) — dù frontend (`ManageWpScreen.tsx`) hiển thị badge theo `status` và giả định filter theo `SAVED`/`POSTED_WP`. Tài liệu cũ mô tả "Giao diện lấy danh sách bài (cho phép filter theo status SAVED hoặc POSTED_WP)" — hiện chưa có, cần bổ sung query param `status` ở `GET /articles` nếu muốn đúng như plan.

  

---

  

## 5. Index Strategy đề xuất

  

Hiện trạng: **chỉ có 2 index thật trong toàn module** — `RawArticle.urlHash` (unique) và `NewsArticle.urlHash` (unique). Mọi filter/sort khác đều full collection scan. Đề xuất bổ sung theo đúng query pattern đang chạy trong code (không thêm index đầu cơ):

  

| Field                    | Type            | Required |       Index       | Note & Giải pháp kỹ thuật                                                                                                                                        |
| :----------------------- | :-------------- | :------: | :---------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **title**                | string          |    Có    |       Không       | Tiêu đề bài viết sau khi AI biên tập.                                                                                                                            |
| **summary**              | string          |  Không   |       Không       | Tóm tắt bài viết.                                                                                                                                                |
| **importanceReason**     | string          |  Không   |       Không       | Lý do đánh giá độ quan trọng từ AI (Job 2).                                                                                                                      |
| **impactLevel**          | string (enum)   |  Không   |      **Có**       | `['Rất cao', 'Cao', 'Trung bình']`. **Nên đánh index** nếu có tính năng lọc tin hot theo độ ảnh hưởng.                                                           |
| **targetAudience**       | string[]        |  Không   |       Không       | Mảng đối tượng mục tiêu.                                                                                                                                         |
| **expertOpinion**        | string          |  Không   |       Không       | Đánh giá chuyên gia từ AI.                                                                                                                                       |
| **publishDate**          | Date            |  Không   | **Có (Compound)** | **SỬA GAP GẤP:** Đổi từ `string` -> `Date`. Đánh Compound Index `{ publishDate: -1, createdAt: -1 }` để xử lý dứt điểm Full Scan ở hàm `getSavedArticles(date)`. |
| **thumbnailUrl**         | string          |  Không   |       Không       | Link ảnh đại diện bài viết.                                                                                                                                      |
| **source**               | string          |  Không   |       Không       | Tên nguồn tin (Liên kết mềm).                                                                                                                                    |
| **url**                  | string          |  Không   |       Không       | Link gốc bài viết.                                                                                                                                               |
| **keywords**             | string[]        |  Không   |       Không       | Mảng từ khóa SEO/Thẻ tag.                                                                                                                                        |
| **urlHash**              | string          |    Có    |    **Unique**     | Băm SHA-256 chống trùng — đã đồng bộ toàn bộ hệ thống (RawArticle cũng dùng SHA-256 từ migration 002).                                                            |
| **wpPostId**             | number / null   |  Không   |  **Có (Sparse)**  | ID bài viết trên WordPress (`default: null`). **Đánh Sparse Index** để tra cứu ngược từ WP Post ID về DB cực nhanh.                                              |
| **content**              | string          |  Không   |       Không       | Nội dung chi tiết đã được AI viết lại.                                                                                                                           |
| **status**               | string[] (enum) |  Không   |      **Có**       | Mảng trạng thái `['CRAWLED', 'POSTED_WP', 'ERROR']`. **Bắt buộc đánh index** vì API sẽ query lọc tin theo trạng thái cực nhiều!                                  |
| **createdAt, updatedAt** | Date            |   Auto   |       Không       | Chuẩn Mongoose `timestamps: true`.                                                                                                                               |
| **deletedAt**            | Date / null     |  Không   |      **Có**       | **BỔ SUNG GAP (Soft Delete):** Đổi hard delete thành `deletedAt` để tránh mất dữ liệu quan trọng khi Admin xóa lỡ tay.                                           |
  

Lưu ý: `crawlConfig` (Object tự do) và `impactLevel`/`keywords`/`targetAudience` không cần index — chưa có query pattern nào lọc theo các field này trong code hiện tại; tránh over-index.

  

---

  

## 6. Soft Delete — GAP hiện tại

  

**Hiện trạng thật:** không có field `deletedAt` ở bất kỳ schema nào trong 3 collection cốt lõi. Toàn bộ delete (single + bulk) ở cả 3 service (`NewsSourceService.remove`, `CustomCrawlerService.deleteRawArticle(s)`, `NewsArticleService.deleteBulkArticles`) đều dùng `findByIdAndDelete`/`deleteMany` — **hard delete thật**, dữ liệu mất vĩnh viễn, không thể khôi phục.

  

Đây vi phạm trực tiếp quy chuẩn "Soft Delete" trong `nodejs-react-mongo-coding-guidelines`. Đề xuất bổ sung (theo nguyên tắc Zero-Downtime — xem mục 7):

  

1. Thêm field vào cả 3 schema:

   ```

   @Prop({ type: Date, default: null })

   deletedAt?: Date;

   ```

   Field mới có `default: null` → tương thích ngược hoàn toàn, document cũ tự nhận `deletedAt = null` khi đọc lại, không cần migration script bulk-update bắt buộc (tuỳ chọn chạy 1 lần `updateMany({}, {$set: {deletedAt: null}})` để đồng bộ index nếu muốn, không bắt buộc vì Mongoose tự áp `default` khi field thiếu).

2. Sửa toàn bộ `find()`/`findAll()`/list query thêm điều kiện `{ deletedAt: null }`.

3. Đổi các hàm `remove`/`deleteRawArticle(s)`/`deleteBulkArticles` từ `deleteMany`/`findByIdAndDelete` sang `updateMany`/`findByIdAndUpdate` set `deletedAt: new Date()`.

4. Endpoint xóa nên đổi method HTTP từ `DELETE`/`POST .../delete-bulk` sang `PATCH` theo đúng RESTful semantics của Soft Delete (delete-bulk hiện dùng `POST`, có thể giữ `POST` cho bulk vì body phức tạp nhưng đơn lẻ nên là `PATCH :id` thay vì `DELETE :id`) — quyết định cụ thể để `coder-agent` triển khai, không bắt buộc đổi route nếu ảnh hưởng FE quá lớn, miễn là hành vi bên trong là soft delete.

5. Bổ sung index `{ deletedAt: 1 }` như mục 5.

  

Rủi ro nếu không sửa: Bulk Delete ở `raw-articles/delete-bulk` và `articles/delete-bulk` là **không thể hoàn tác** — nếu người dùng chọn nhầm ID, dữ liệu mất vĩnh viễn, không có Audit Trail để tra lại (xem `TECHNICAL_DESIGN.md` mục Audit Trail).

  

---

  

## 7. Zero-Downtime Schema Changelog

  

Khung theo dõi thay đổi schema — mọi thay đổi field trong 3 collection cốt lõi (thêm/sửa/xóa) phải được log vào đây **trước khi merge**, kèm xác nhận tương thích ngược. Bảng này khởi tạo trống, điền dần theo thời gian.

  

Hướng dẫn ghi log:

- **Collection**: tên collection bị ảnh hưởng.

- **Change**: mô tả ngắn (thêm field / đổi type / đổi enum...).

- **Backward Compatible?**: Có/Không — nếu Không, phải giải thích migration path (dual-write, default value, dry-run trước).

- **Migration script**: đường dẫn script nếu cần backfill dữ liệu cũ (VD: `scripts/migrations/2026xxxx_add_deletedAt.ts`), hoặc "Không cần" nếu default value đủ xử lý.

- **Author / PR**: người thực hiện + link PR để tra cứu.

  

| Date | Collection | Change | Backward Compatible? | Migration script | Author / PR |
| :---: | :--- | :--- | :---: | :--- | :--- |
| *YYYY-MM-DD* | *Tên Collection* | *Mô tả ngắn gọn thay đổi* | *Yes/No* | *File / Script thực thi* | *Người thực hiện / PR Link* |
| 2026-07-27 | `NewsArticle`, `RawArticle`, `NewsSource` | Bổ sung field `deletedAt: Date` (Soft Delete) & Đánh Compound Index | **Yes** | `scripts/migrations/001_add_deleted_at_index.ts` | Neptune / [#102](https://github.com/...) |
| 2026-07-28 | `RawArticle`, `NewsArticle` | Đổi `urlHash` từ MD5 (32 hex) sang SHA-256 (64 hex) — đồng bộ cả 2 collection (RawArticle + NewsArticle sinh từ Bulk Move mang MD5 cũ). Giá trị hash đổi, unique index giữ nguyên. Dedup theo `url` trước rehash để tránh xung unique khi 2 hash MD5 cũ của cùng url thu về 1 hash SHA-256. | **No** | `RealEstateBackendApp/scripts/migrations/002_recompute_urlhash_sha256.ts` (dry-run mặc định, `--apply` để ghi — bọc transaction + snapshot backup) | coder-backend-agent / [#TBD](https://github.com/...) |

  

Quy tắc cứng khi thêm dòng mới vào bảng trên:

- Field mới bắt buộc có `default` hoặc `required: false` — không được thêm field `required: true` vào schema đã có dữ liệu production mà không backfill trước.

- Không đổi tên field trực tiếp — nếu cần rename, thêm field mới, dual-read (đọc field mới, fallback field cũ) trong ít nhất 1 release, rồi mới xóa field cũ ở release sau và ghi thêm 1 dòng changelog riêng cho việc xóa.

- Không đổi kiểu dữ liệu field đang có dữ liệu (VD: `status` từ string đơn sang mảng đã từng xảy ra trong lịch sử thật của module này — code hiện tại còn nguyên logic "migration ngầm" ở `NewsArticleService` để tự chuẩn hoá `article.status` từ string cũ sang mảng mỗi lần đọc/lưu, xem `publishToWordPress`, `analyzeMarketBulk`, `cleanArticle`). Đây là ví dụ thực tế nên tham khảo cho các thay đổi enum/type tương lai: giữ logic normalize tạm thời trong service thay vì migration script cứng, nếu volume dữ liệu nhỏ và chấp nhận được.

  

---

  

## 8. Collection phụ: `market_analysis_histories` (schema `MarketAnalysisHistory`)

  

Không thuộc 3 collection cốt lõi theo yêu cầu outline, nhưng có thật trong code nên liệt kê ngắn để không bỏ sót khi audit toàn diện:

  

| Field | Type | Required | Index | Note & Giải pháp kỹ thuật |
| :--- | :--- | :-: | :-: | :--- |
| **content** | string | Có | Không | Báo cáo/Phân tích thị trường dạng Markdown do AI sinh ra. |
| **articleIds** | ObjectId[] | Có | **Có** | Mảng chứa ID các `NewsArticle`. **GAP:** Đổi `string[]` -> `Types.ObjectId[]` để queryJOIN/Aggregate và đánh Multikey Index! |
| **createdAt, updatedAt** | Date | Auto | **Có** | Chuẩn Mongoose `timestamps: true`. **Đánh Index `createdAt`** để hỗ trợ truy vấn báo cáo mới nhất. |
| **deletedAt** | Date / null | Không | **Có** | **BỔ SUNG GAP (Soft Delete):** Giúp lưu trữ và khôi phục các báo cáo phân tích quan trọng khi lỡ tay xóa. |
  

Không có `deletedAt` (không có tính năng xóa cho collection này trong code hiện tại — `getMarketAnalysisHistory`/`getMarketAnalysisHistoryById` chỉ đọc). Nếu tương lai thêm tính năng xóa, áp dụng cùng quy chuẩn Soft Delete ở mục 6.