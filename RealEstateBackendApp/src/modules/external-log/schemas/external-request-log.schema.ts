import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Loại outgoing request được ghi log.
 * - CRAWL_OUTGOING: HTTP request cào dữ liệu (RSS/HTML) từ các trang báo.
 * - AI_OUTGOING:    HTTP request gọi AI provider (OpenRouter, Must1c...) để lọc/trích xuất.
 * Backward compatible: chỉ THÊM giá trị mới, không sửa/xóa giá trị cũ.
 */
export enum ExternalRequestType {
  CRAWL_OUTGOING = 'CRAWL_OUTGOING',
  AI_OUTGOING = 'AI_OUTGOING',
}

/* =====================================================================
 * Sub-document (nested schema) — đặt TRƯỚC class cha để decorator
 * @Prop({ type: XxxSchema }) có thể tham chiếu schema đã tạo.
 * Dùng { _id: false } để không tạo _id thừa cho sub-document.
 * ===================================================================== */

/** Payload request gửi đi (đã sanitize + truncate). */
@Schema({ _id: false })
export class RequestPayload {
  /** Header gửi đi — ĐÃ sanitize (API key/token/cookie bị mask). */
  @Prop({ type: Object, default: {} })
  headers: Record<string, any>;

  /** Query string params — ĐÃ mask giá trị nhạy cảm. */
  @Prop({ type: Object, default: {} })
  query: Record<string, any>;

  /** Path params (chủ yếu dùng cho crawl). */
  @Prop({ type: Object, default: {} })
  params: Record<string, any>;

  /** Request body: object (JSON) hoặc string (HTML/RSS raw). Đã truncate nếu quá lớn. */
  @Prop({ type: Object, default: null })
  body: any;

  /** Prompt đầy đủ gửi tới AI (chỉ có với AI_OUTGOING; crawl để rỗng). */
  @Prop({ type: String, default: '' })
  prompt?: string;
}
export const RequestPayloadSchema =
  SchemaFactory.createForClass(RequestPayload);

/** Token usage — map từ usage snake_case của OpenAI-compatible API. */
@Schema({ _id: false })
export class TokenUsage {
  @Prop({ type: Number, default: 0 })
  promptTokens: number;

  @Prop({ type: Number, default: 0 })
  completionTokens: number;

  @Prop({ type: Number, default: 0 })
  totalTokens: number;
}
export const TokenUsageSchema = SchemaFactory.createForClass(TokenUsage);

/** Payload response nhận về (đã sanitize + truncate). */
@Schema({ _id: false })
export class ResponsePayload {
  /** Response header — ĐÃ sanitize (set-cookie bị mask). */
  @Prop({ type: Object, default: {} })
  headers: Record<string, any>;

  /** Response body: object (JSON) hoặc string (HTML/RSS raw). Đã truncate nếu quá lớn. */
  @Prop({ type: Object, default: null })
  body: any;

  /** Token usage (chỉ AI_OUTGOING). */
  @Prop({ type: TokenUsageSchema })
  usage?: TokenUsage;
}
export const ResponsePayloadSchema =
  SchemaFactory.createForClass(ResponsePayload);

/** Thông tin lỗi (nếu request thất bại / có exception). */
@Schema({ _id: false })
export class ErrorInfo {
  @Prop({ type: String })
  message?: string;

  /** err.code (VD: ECONNABORTED, ETIMEDOUT) hoặc err.name (VD: AbortError). */
  @Prop({ type: String })
  code?: string;

  @Prop({ type: String })
  stack?: string;
}
export const ErrorInfoSchema = SchemaFactory.createForClass(ErrorInfo);

/* =====================================================================
 * Schema chính
 * ===================================================================== */

/**
 * Log tập trung cho mọi outgoing request: crawl (ra trang báo) + AI (ra AI provider).
 * Chỉ có createdAt — log bất biến, không bao giờ update.
 * Collection: external_request_logs (khai báo tường minh — không để mongoose tự pluralize).
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'external_request_logs',
})
export class ExternalRequestLog extends Document {
  /** Loại request: 'CRAWL_OUTGOING' | 'AI_OUTGOING'. */
  @Prop({ required: true, enum: ExternalRequestType })
  type: ExternalRequestType;

  /**
   * Tên dịch vụ/trang đích:
   * - CRAWL_OUTGOING: tên trang báo (VD: 'VnExpress', 'Batdongsan.com.vn').
   * - AI_OUTGOING:    tên AI provider (VD: 'OpenRouter', 'Must1c').
   */
  @Prop({ required: true, trim: true })
  targetService: string;

  /** HTTP method — tự uppercase (VD: 'get' → 'GET'). */
  @Prop({ required: true, uppercase: true })
  method: string;

  /** URL đầy đủ — query param nhạy cảm ĐÃ được mask (xem sanitizer). */
  @Prop({ required: true })
  url: string;

  /** HTTP status code nhận về (undefined nếu network error / exception). */
  @Prop({ type: Number })
  statusCode?: number;

  /** Tổng thời gian request (ms). */
  @Prop({ type: Number, required: true, min: 0 })
  durationMs: number;

  /** Request payload đã sanitize + truncate. */
  @Prop({ type: RequestPayloadSchema })
  request: RequestPayload;

  /** Response payload đã sanitize + truncate. */
  @Prop({ type: ResponsePayloadSchema })
  response?: ResponsePayload;

  /** Thông tin lỗi nếu có. */
  @Prop({ type: ErrorInfoSchema })
  error?: ErrorInfo;

  /** Tên class/module phát ra request: 'CustomCrawlerService', 'AIFilterService', 'FirecrawlService'. */
  @Prop({ required: true, trim: true })
  sourceModule: string;

  /** Extension point (tùy chọn): model AI, urlHash, requestId... — theo convention AuditLog.metadata. */
  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>;

  /** Tự động tạo bởi timestamps option — dùng cho TTL index. */
  createdAt: Date;
}

export const ExternalRequestLogSchema =
  SchemaFactory.createForClass(ExternalRequestLog);

/* =====================================================================
 * Indexes — khai báo SAU createForClass (theo convention dự án).
 * ===================================================================== */

// Retention: LOG_RETENTION_DAYS (mặc định 30 ngày) → expireAfterSeconds.
// Tính tại thời điểm khai báo index (§7.2 spec) — index được tạo lúc module init.
// Lưu ý: đổi giá trị sau khi index đã tồn tại trong MongoDB không tự cập nhật
// (cần drop/re-create index hoặc chấp nhận giá trị mặc định 30 ngày).
const LOG_RETENTION_DAYS_DEFAULT = 30;
const retentionDays = Number.parseInt(process.env.LOG_RETENTION_DAYS ?? '', 10);
const RETENTION_SECONDS =
  (Number.isFinite(retentionDays) && retentionDays > 0
    ? retentionDays
    : LOG_RETENTION_DAYS_DEFAULT) * 86400;

// Index chính cho màn hình admin: lọc theo type rồi sort mới nhất.
ExternalRequestLogSchema.index({ type: 1, createdAt: -1 });

// Lọc nhanh theo dịch vụ/trang đích.
ExternalRequestLogSchema.index({ targetService: 1 });

// Lọc nhanh theo status code (VD: tìm toàn bộ 403 anti-bot).
ExternalRequestLogSchema.index({ statusCode: 1 });

// TTL: tự động xóa log sau LOG_RETENTION_DAYS (mặc định 30 ngày).
// LƯU Ý: TTL index PHẢI là single-field index trên trường Date —
//        KHÔNG được ghép vào compound index.
ExternalRequestLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: RETENTION_SECONDS },
);
