Technical Design Document: NewsFireCrawlManager (Enterprise Standard)

Tài liệu này được tạo ra bởi Architect Agent nhằm mô tả chi tiết thiết kế kỹ thuật cho module NewsFireCrawlManager trên backend NestJS. Thiết kế này tuân thủ tuyệt đối các quy tắc trong PROJECT_CONTEXT (Bảo mật, Soft Delete, Tối ưu DB, và Cơ chế chống lỗi).

1. Database Schema (Mongoose)

Lưu ý chung: Bắt buộc áp dụng cơ chế Soft Delete (cột deletedAt) thay vì xóa cứng dữ liệu.

Collection: news_sources (Schema: NewsSourceSchema)

Dùng để quản lý các link/nguồn tin cần crawl (Phase 5).

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
  crawlConfig: Record<string, any>; // Cấu hình riêng cho Firecrawl

  @Prop({ type: Date, default: null })
  deletedAt?: Date; // Áp dụng Soft Delete
}

export const NewsSourceSchema = SchemaFactory.createForClass(NewsSource);


Collection: raw_articles (Schema: RawArticleSchema)

Lưu trữ dữ liệu thô crawl về.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true })
export class RawArticle extends Document {
  @Prop({ required: true })
  title: string;

  @Prop()
  description?: string;

  @Prop()
  content?: string;

  @Prop({ required: true })
  url: string;

  @Prop({ required: true, unique: true, index: true })
  urlHash: string; // Khóa Unique chống trùng

  @Prop()
  publishedAt?: string;

  @Prop()
  thumbnailUrl?: string;

  @Prop({ required: true })
  source: string;

  @Prop({ type: Date, default: null })
  deletedAt?: Date; // Áp dụng Soft Delete
}

export const RawArticleSchema = SchemaFactory.createForClass(RawArticle);


Collection: news_articles (Schema: NewsArticleSchema)

Dữ liệu chính thức được lưu. Bắt buộc dùng Types.ObjectId để liên kết (Relation) với NewsSource chống N+1 Query.

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum NewsStatus {
  SAVED = 'SAVED',
  POSTED_WP = 'POSTED_WP',
  ERROR = 'ERROR',
}

@Schema({ timestamps: true })
export class NewsArticle extends Document {
  @Prop({ required: true })
  title: string;

  @Prop({ required: false })
  summary: string;

  @Prop({ required: false })
  importanceReason: string;

  @Prop({ required: false, enum: ['Rất cao', 'Cao', 'Trung bình'] })
  impactLevel: string;

  @Prop({ type: [String], required: false })
  targetAudience: string[];

  @Prop({ required: false })
  expertOpinion: string;

  @Prop({ required: false })
  publishDate: string;

  @Prop({ required: false })
  thumbnailUrl: string;

  // Bắt buộc dùng ObjectId Reference để dùng .populate()
  @Prop({ type: Types.ObjectId, ref: 'NewsSource', required: false })
  sourceId: Types.ObjectId; 

  @Prop({ required: false })
  url: string;

  @Prop({ type: [String], required: false })
  keywords: string[];

  @Prop({ required: true, unique: true, index: true })
  urlHash: string;

  @Prop({ default: null })
  wpPostId: number;

  @Prop({ type: String, enum: NewsStatus, default: NewsStatus.SAVED })
  status: NewsStatus;

  @Prop({ type: Date, default: null })
  deletedAt?: Date; // Áp dụng Soft Delete
}

export const NewsArticleSchema = SchemaFactory.createForClass(NewsArticle);


2. API Design Guidelines & Contracts

Module không hard-code các URL cụ thể. Coder Agent tự quyết định định tuyến RESTful phù hợp, nhưng bắt buộc tuân thủ các giao kèo (Contracts) sau:

Quy tắc chung cho toàn bộ API:

Swagger & DTO: 100% Request Body/Query phải được định nghĩa bằng các Class DTO và gắn decorators của @nestjs/swagger để tự sinh tài liệu API.

Response List: Mọi API GET danh sách (List) bắt buộc trả về format: { data: T[], meta: { total, page, limit, totalPages } }.

2.1 Nhóm API Vận hành & Cronjob

Kích hoạt luồng (Trigger): Cung cấp interface kích hoạt thủ công quy trình Crawl (Job 1) và AI Filter (Job 2).

Quản lý tự động: Cung cấp interface truy vấn trạng thái (Status) và bật/tắt (Toggle) Cronjob của hệ thống.

2.2 Nhóm API Nguồn tin (News Source)

Cung cấp đầy đủ các thao tác CRUD (Tạo mới, Lấy danh sách, Cập nhật, Xóa) cho NewsSource.

Ràng buộc thép:

API GET List chỉ trả về các record có deletedAt: null.

API Delete bắt buộc triển khai dưới dạng Soft Delete (Dùng phương thức PATCH để cập nhật field deletedAt), tuyệt đối không xóa vật lý khỏi Database.

2.3 Nhóm API Bài viết (Articles) & Xử lý hàng loạt (Bulk)

Quản lý dữ liệu thô (Raw Articles):

Giao diện lấy danh sách có phân trang.

Giao diện xử lý hàng loạt: Bulk Delete (Xóa mềm nhiều bài) và Bulk Move (Lưu tin chọn lọc thành tin chính thức).

Ràng buộc Bulk Move: Logic chuyển đổi phải bảo toàn nguyên vẹn chuỗi urlHash và xử lý bắt lỗi Duplicate Key an toàn.

Quản lý dữ liệu chuẩn bị đăng WP (News Articles):

Giao diện lấy danh sách bài (cho phép filter theo status SAVED hoặc POSTED_WP).

Giao diện Bulk Delete (Xóa mềm hàng loạt).

Xuất bản bài viết (Publish to WordPress):

Giao diện tiếp nhận danh sách ID bài viết cần đăng, sau đó gọi ngầm sang WordPress REST API.

Ràng buộc thép: Bắt buộc áp dụng cơ chế xác thực Header Idempotency-Key từ Frontend gửi lên để tránh tình trạng mạng lag sinh ra đăng đúp nhiều bài cùng lúc.

3. Component & Service Architecture

Module NewsFireCrawlManagerModule chia nhỏ Service tuân thủ Single Responsibility và đảm bảo an toàn kết nối (Resilience).

NewsFireCrawlManagerController: Cung cấp Endpoints, đón request, validate DTO.

NewsSourceService: CRUD nguồn tin (Lưu ý chỉ query những record có deletedAt: null).

FirecrawlService (External API):

Kết nối API quét dữ liệu.

Luật Thép: Bắt buộc cấu hình Timeout (VD: 15s) và cơ chế Retry + Exponential Backoff để chống treo server nếu Firecrawl bị lag.

AIFilterService (External API):

Kết nối AI Provider (Gemini/Claude) qua System Prompt nghiêm ngặt.

Luật Thép: Bắt buộc cấu hình Timeout (VD: 30s) vì AI response lâu, kèm cơ chế báo lỗi mạch lạc (Circuit Breaker).

NewsArticleService:

Thao tác Database chính. Sinh urlHash (crypto sha256).

WordPressService (External API):

Đẩy POST request tới WordPress REST API, đính kèm urlHash.

Luật Thép: Bắt buộc có cơ chế Idempotency và Retry nếu network chập chờn.

CronjobService: Cấu hình tự động theo @nestjs/schedule. Đảm bảo có Redis/Distributed Lock để không chạy đè 2 job cùng lúc.

4. Frontend & Screens

(Không thay đổi, giữ nguyên UI theo Business Plan: RawArticlesScreen & ManageWpScreen với Table, Bulk Actions, và chuẩn format DD/MM/YYYY).