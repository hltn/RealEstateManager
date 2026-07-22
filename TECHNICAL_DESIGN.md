# Technical Design Document: NewsFireCrawlManager

Tài liệu này được tạo ra bởi **Architect Agent** nhằm mô tả chi tiết thiết kế kỹ thuật cho module `NewsFireCrawlManager` trên backend NestJS, làm cơ sở cho Coder Agent thực hiện.

## 1. Database Schema (Mongoose)

### Collection: `news_sources` (Schema: `NewsSourceSchema`)

Dùng để quản lý các link/nguồn tin cần crawl (Phase 5).

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class NewsSource extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  url: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Object, default: {} })
  crawlConfig: Record<string, any>; // Cấu hình riêng cho Firecrawl (depth, rules...)
}

export const NewsSourceSchema = SchemaFactory.createForClass(NewsSource);
```

### Collection: `news_articles` (Schema: `NewsArticleSchema`)

Lưu ý: Job 1 và Job 2 chỉ xử lý dữ liệu trung gian qua file JSON. Dữ liệu chỉ được lưu vào Database ở Job 3 (khi người dùng bấm lưu từ Admin UI). Do đó, ta chỉ cần một Collection chính để lưu trữ các bài viết đã được duyệt.

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum NewsStatus {
  SAVED = 'SAVED',
  POSTED_WP = 'POSTED_WP',
  ERROR = 'ERROR',
}

@Schema({ timestamps: true })
export class NewsArticle extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  summary: string;

  @Prop({ required: true })
  importanceReason: string;

  @Prop({ required: true, enum: ['Rất cao', 'Cao', 'Trung bình'] })
  impactLevel: string;

  @Prop({ type: [String], required: true })
  targetAudience: string[]; // Nhà đầu tư, Người mua ở thực, Chủ đầu tư...

  @Prop({ required: true })
  expertOpinion: string;

  @Prop({ required: true })
  publishDate: string; // ISO date string

  @Prop({ required: true })
  source: string; // Tên nguồn hoặc ID tham chiếu tới NewsSource

  @Prop({ required: true })
  url: string;

  @Prop({ type: [String], required: true })
  keywords: string[];

  // Trường chống trùng lặp: băm SHA-256 từ `url` (sau khi chuẩn hóa)
  @Prop({ required: true, unique: true, index: true })
  urlHash: string;

  // Dữ liệu WordPress
  @Prop({ default: null })
  wpPostId: number;

  @Prop({ type: String, enum: NewsStatus, default: NewsStatus.SAVED })
  status: NewsStatus;
}

export const NewsArticleSchema = SchemaFactory.createForClass(NewsArticle);
```

## 2. API Endpoints

Module cần expose các API RESTful để Admin UI (Frontend) kết nối.

### 2.1 API Màn hình 1 (Kích hoạt thủ công & Duyệt tin)
- **Kích hoạt thu thập tin tức thủ công**
  - `POST /api/news-manager/trigger`
  - *Mô tả:* Kích hoạt luồng Firecrawl (Job 1) -> AI Processing (Job 2). Quá trình này sẽ sinh ra file JSON chứa 5 bài viết xuất sắc nhất.
  - *Response:* Mảng JSON 5 bản tin (chứa 10 trường).
- **Lưu tin tức đã chọn vào Database (Job 3)**
  - `POST /api/news-manager/articles/save`
  - *Body:* Array các object bản tin (kèm url).
  - *Logic:* Tạo `urlHash` và insert vào DB. Bỏ qua các `urlHash` đã tồn tại.

### 2.2 API Màn hình 2 (Job 4 - WordPress)
- **Lấy danh sách bản tin (Data Table)**
  - `GET /api/news-manager/articles`
  - *Query Params:* `page`, `limit`, `status` (để có thể lọc bài chưa đăng và bài đã đăng).
- **Đăng bài lên WordPress**
  - `POST /api/news-manager/articles/publish`
  - *Body:* `articleIds` (danh sách ID trong Mongo).
  - *Logic:* Fetch từ Mongo -> POST sang WP REST API -> Cập nhật `wpPostId` và `status`.

### 2.3 API Màn hình 3 (Quản lý Cronjob)
- **Quản lý Cronjob**
  - `GET /api/news-manager/cron/status` -> Trả về cấu hình/tình trạng cronjob (đang bật hay tắt).
  - `POST /api/news-manager/cron/toggle` -> Bật/Tắt cronjob.

### 2.4 API Màn hình 4 (Quản lý Nguồn tin - Phase 5)
- **Lấy danh sách Nguồn tin**
  - `GET /api/news-manager/sources`
  - *Response:* Mảng JSON các `NewsSource`.
- **Thêm Nguồn tin mới**
  - `POST /api/news-manager/sources`
  - *Body:* `{ name, url, isActive, crawlConfig }`
- **Cập nhật Nguồn tin**
  - `PUT /api/news-manager/sources/:id`
  - *Body:* `{ name, url, isActive, crawlConfig }` (Cập nhật thông tin hoặc Bật/tắt `isActive`).
- **Xóa Nguồn tin**
  - `DELETE /api/news-manager/sources/:id`

## 3. Component & Service Architecture

Module `NewsFireCrawlManagerModule` sẽ bao gồm các Services (Providers) độc lập nhằm tuân thủ nguyên lý Single Responsibility.

1. **`NewsFireCrawlManagerController`:** Cung cấp các endpoints cho Frontend gọi.
2. **`NewsSourceService` (Phase 5):**
   - Quản lý logic CRUD cho `NewsSource`.
   - Cung cấp hàm lấy danh sách các nguồn tin đang active (`isActive: true`).
3. **`FirecrawlService` (Job 1):**
   - Đảm nhiệm kết nối SDK/API của Firecrawl.
   - **Tích hợp Phase 5:** Truy xuất danh sách nguồn tin có `isActive: true` (thông qua `NewsSourceService`) để làm đầu vào động.
   - Crawl danh mục -> lấy link -> crawl chi tiết dựa trên các URL động này.
   - Lưu kết quả trung gian ra file JSON tạm ở thư mục `/tmp`.
4. **`AIFilterService` (Job 2):**
   - Đọc JSON từ `FirecrawlService`.
   - Kết nối với AI Provider (Gemini/Claude).
   - Gửi System Prompt ép buộc trả về cấu trúc JSON mảng 5 phần tử, mỗi phần tử chứa đúng 10 trường dữ liệu đã chốt.
   - Lưu file JSON kết quả (hoặc trả trực tiếp về Controller).
5. **`NewsArticleService` (Job 3 & 4):**
   - Xử lý tương tác với Mongoose Model `NewsArticle`.
   - Sinh `urlHash` (crypto `sha256`) trước khi lưu để chặn trùng lặp.
   - Cung cấp hàm fetch danh sách bài viết.
6. **`WordPressService` (Job 4):**
   - Gọi HTTP Client tới WordPress REST API (`/wp-json/wp/v2/posts`).
   - Đính kèm meta field `urlHash` khi gửi đi (để tầng WP kiểm tra trùng lặp).
7. **`CronjobService`:**
   - Dùng `@nestjs/schedule` để hẹn giờ gọi luồng `Job1 -> Job2 -> Tự động lưu DB (nếu có cấu hình cho phép tự động)` hoặc chỉ dừng ở sinh file.
