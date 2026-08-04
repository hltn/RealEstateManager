# ExternalLogModule — Design Spec (Phase 1: Architecture & Data Schema)

> Tài liệu thiết kế cho tính năng **ghi log tập trung mọi Outgoing Request**:
> (1) **Crawl Request** — HTTP request cào dữ liệu tin tức từ các trang báo (VnExpress, Vietnamnet, Cafeland, Batdongsan…);
> (2) **AI Request** — HTTP request gọi AI Provider (OpenRouter, Must1c…) để lọc bài, trích xuất, tóm tắt.
>
> - **Nguồn yêu cầu:** `docs/REQUEST_LOGGING_PLAN.md`
> - **Phạm vi tài liệu:** Phase 1 — thiết kế Schema + Sanitization + Indexing/Retention + cấu trúc module.
> - **Người thực thi tiếp theo:** `coder-backend-agent` (Phase 2) — implement theo đúng spec này.
> - **Ràng buộc:** tài liệu này KHÔNG thay đổi bất kỳ code nào trong `src/`. Toàn bộ code trong đây là *tham chiếu* (reference implementation), Phase 2 mới đưa vào `src/`.

---

## Mục lục

1. [Tổng quan & Mục tiêu](#1-tổng-quan--mục-tiêu)
2. [Phạm vi: ghi gì / không ghi gì](#2-phạm-vi-ghi-gì--không-ghi-gì)
3. [Mongoose Schema `ExternalRequestLog`](#3-mongoose-schema-externalrequestlog)
4. [Reference Implementation (TypeScript)](#4-reference-implementation-typescript)
5. [Quy tắc Sanitization & Masking](#5-quy-tắc-sanitization--masking)
6. [Giới hạn kích thước payload (Truncation)](#6-giới-hạn-kích-thước-payload-truncation)
7. [Indexing & Retention Policy](#7-indexing--retention-policy)
8. [Kiến trúc module `ExternalLogModule`](#8-kiến-trúc-module-externallogmodule)
9. [Bản đồ tích hợp với service hiện có](#9-bản-đồ-tích-hợp-với-service-hiện-có)
10. [Admin Query API (contract cho Phase 2)](#10-admin-query-api-contract-cho-phase-2)
11. [Biến môi trường](#11-biến-môi-trường)
12. [Xử lý lỗi & cơ chế Fire-and-forget](#12-xử-lý-lỗi--cơ-chế-fire-and-forget)
13. [Ví dụ document mẫu](#13-ví-dụ-document-mẫu)
14. [Tiêu chí nghiệm thu](#14-tiêu-chí-nghiệm-thu)
15. [Checklist cho Phase 2 (`coder-backend-agent`)](#15-checklist-cho-phase-2-coder-backend-agent)

---

## 1. Tổng quan & Mục tiêu

Hệ thống hiện tại thực hiện 2 loại request ra bên ngoài nhưng **không có nơi nào ghi lại lịch sử đầy đủ** (URL, status, body, duration, token usage, stack trace lỗi). Khi trang báo trả 403 anti-bot, khi AI trả lỗi hoặc tốn token bất thường, dev/admin không có dữ liệu để điều tra.

**Mục tiêu:** tạo collection MongoDB `external_request_logs` lưu MỌI outgoing request với đầy đủ metadata, tự động che các bí mật (API key, token, cookie), tự động xóa log cũ sau 30 ngày, và KHÔNG làm chậm luồng crawl/AI chính (fire-and-forget).

**Yêu cầu cốt lõi từ Oniichan:**
- Ghi log **mọi** CRAWL request (HTTP ra ngoài cào tin từ trang báo).
- Ghi log **mọi** AI request (gọi AI provider để lọc/trích xuất tin).
- **KHÔNG** ghi log API request nội bộ từ admin/mobile app vào NestJS backend.
- Đầy đủ: status, body, response, duration, error stack, token usage (AI).

---

## 2. Phạm vi: ghi gì / không ghi gì

| Ghi log ✅ | Không ghi log ❌ |
|---|---|
| HTTP request cào RSS/HTML ra trang báo (`CustomCrawlerService.fetchWithAntiBotBypass` → axios) | Mọi request từ Client/Admin/Mobile App vào NestJS backend |
| HTTP request gọi AI provider (`AIFilterService` → OpenRouter `https://openrouter.ai/api/v1/chat/completions`, Must1c `https://htmustc.id.vn/v1/chat/completions`) | Request nội bộ giữa các service NestJS với nhau |
| Request Firecrawl SDK (nếu module Firecrawl được kích hoạt lại) | Health check / internal endpoint |
| Lỗi crawl (403 anti-bot, timeout, network error) kèm raw HTML error | — |
| Lỗi AI (invalid key, rate limit 429, timeout 300s) kèm stack trace | — |

**Nguyên tắc chốt:** log chỉ được sinh ra từ *điểm gọi HTTP ra ngoài* (choke point), không phải từ middleware/guard/interceptor toàn cục của NestJS — vì interceptor toàn cục sẽ bắt cả request nội bộ (vi phạm yêu cầu).

---

## 3. Mongoose Schema `ExternalRequestLog`

### 3.1 Thông tin chung

| Thuộc tính | Giá trị |
|---|---|
| Class | `ExternalRequestLog` |
| Collection | `external_request_logs` (**phải khai báo tường minh** qua option `collection` — mongoose mặc định tự pluralize thành `externalrequestlogs`, không đúng tên yêu cầu) |
| Timestamps | `{ createdAt: true, updatedAt: false }` — log bất biến, không bao giờ sửa (theo đúng convention `audit-log.schema.ts`) |
| Strict mode | Mặc định `true` (mongoose tự bỏ field không khai báo — bảo vệ schema) |

### 3.2 Bảng field đầy đủ

| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `type` | `enum` | ✅ | `'CRAWL_OUTGOING'` \| `'AI_OUTGOING'` — phân loại request |
| `targetService` | `string` | ✅ | Tên dịch vụ/trang đích: crawl → tên trang báo (`'VnExpress'`, `'Batdongsan.com.vn'`); AI → tên provider (`'OpenRouter'`, `'Must1c'`) |
| `method` | `string` | ✅ | HTTP method: `GET`, `POST`, `PUT`… (uppercase) |
| `url` | `string` | ✅ | URL đầy đủ, **đã mask query param nhạy cảm** (xem §5) |
| `statusCode` | `number` | ❌ | HTTP status nhận về (`200`, `403` Cloudflare, `429` rate limit…). `undefined` nếu network error/exception |
| `durationMs` | `number` | ✅ | Tổng thời gian request (ms), `>= 0` |
| `request.headers` | `object` | ✅ (default `{}`) | Header gửi đi, **đã sanitize** |
| `request.query` | `object` | ✅ (default `{}`) | Query params, **đã mask giá trị nhạy cảm** |
| `request.params` | `object` | ✅ (default `{}`) | Path params (chủ yếu crawl) |
| `request.body` | `Mixed` | ❌ | Request body: object (JSON) hoặc string (HTML/RSS raw). Đã truncate nếu quá lớn (§6) |
| `request.prompt` | `string` | ❌ (default `''`) | Prompt đầy đủ gửi AI (chỉ `AI_OUTGOING`); crawl để rỗng |
| `response.headers` | `object` | ✅ (default `{}`) | Response header, **đã sanitize** (`set-cookie` bị mask) |
| `response.body` | `Mixed` | ❌ | Response body: object (JSON) hoặc string (HTML/RSS raw). Đã truncate nếu quá lớn (§6) |
| `response.usage.promptTokens` | `number` | ❌ (default `0`) | Token input — map từ `usage.prompt_tokens` (OpenAI-compatible) |
| `response.usage.completionTokens` | `number` | ❌ (default `0`) | Token output — map từ `usage.completion_tokens` |
| `response.usage.totalTokens` | `number` | ❌ (default `0`) | Tổng token — map từ `usage.total_tokens` |
| `error.message` | `string` | ❌ | Message lỗi (đã sanitize nếu chứa secret) |
| `error.code` | `string` | ❌ | Mã lỗi: `err.code` (VD `ECONNABORTED`, `ETIMEDOUT`) hoặc `err.name` (VD `AbortError`) |
| `error.stack` | `string` | ❌ | Stack trace (`err.stack`) |
| `sourceModule` | `string` | ✅ | Tên class/module phát request: `'CustomCrawlerService'`, `'AIFilterService'`, `'FirecrawlService'` |
| `metadata` | `object` | ❌ (default `{}`) | **Extension point (tùy chọn)**: model AI, urlHash, requestId… — theo convention `AuditLog.metadata` |
| `createdAt` | `Date` | ✅ (auto) | Tự động tạo bởi timestamps option — dùng cho TTL index |

> **Lưu ý quan trọng về naming:** các provider OpenAI-compatible (OpenRouter/Must1c) trả `usage` dưới dạng **snake_case** (`prompt_tokens`, `completion_tokens`, `total_tokens`). Service logger (Phase 2) phải **map snake_case → camelCase** trước khi lưu. Schema KHÔNG lưu snake_case.

---

## 4. Reference Implementation (TypeScript)

Code tham chiếu cho `src/modules/external-log/schemas/external-request-log.schema.ts`.
Tuân thủ 100% convention dự án đã verify từ `audit-log.schema.ts`:
`@Schema({ timestamps: { createdAt: true, updatedAt: false } })` · enum export đầu file · index khai báo **sau** `SchemaFactory.createForClass()` · TTL dùng `expireAfterSeconds`.

```typescript
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
export const RequestPayloadSchema = SchemaFactory.createForClass(RequestPayload);

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
export const ResponsePayloadSchema = SchemaFactory.createForClass(ResponsePayload);

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

// Index chính cho màn hình admin: lọc theo type rồi sort mới nhất.
ExternalRequestLogSchema.index({ type: 1, createdAt: -1 });

// Lọc nhanh theo dịch vụ/trang đích.
ExternalRequestLogSchema.index({ targetService: 1 });

// Lọc nhanh theo status code (VD: tìm toàn bộ 403 anti-bot).
ExternalRequestLogSchema.index({ statusCode: 1 });

// TTL: tự động xóa log sau 30 ngày (2592000s = 30 * 24 * 60 * 60).
// LƯU Ý: TTL index PHẢI là single-field index trên trường Date —
//        KHÔNG được ghép vào compound index.
ExternalRequestLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 2592000 },
);
```

---

## 5. Quy tắc Sanitization & Masking

### 5.1 Nguyên tắc chung

1. **Sanitize trước khi tạo document log** — secret KHÔNG bao giờ chạm tới Mongoose model.
2. **KHÔNG mutate object gốc** — sanitizer phải deep-clone rồi mới mask. Request config trong `fetchWithAntiBotBypass` (`requestConfig`) được **tái sử dụng** cho request thứ 2 (anti-bot retry) — nếu mutate sẽ làm hỏng luồng crawl thật.
3. **Giá trị thay thế cố định:** `***REDACTED***` (đúng tiêu chí nghiệm thu trong `REQUEST_LOGGING_PLAN.md`).
4. Sanitize áp dụng cho: `request.headers`, `request.query`, `request.params`, `request.body`, `request.prompt`, `response.headers`, `response.body`, `error.message`, và phần query của `url`.

### 5.2 Header nhạy cảm (case-insensitive)

Mask toàn bộ giá trị của các header sau:

```
authorization, proxy-authorization, x-api-key, api-key, x-auth-token,
x-access-token, x-goog-api-key, x-rapidapi-key, x-firecrawl-api-key,
x-csrf-token, x-xsrf-token, token, cookie, set-cookie, session, secret
```

> **Bắt buộc mask `cookie` / `set-cookie`:** `custom-crawler.service.ts` có comment bảo mật rõ ràng *"Lưu ý bảo mật: KHÔNG log giá trị cookie"* — cookie `D1N=...` dùng để bypass anti-bot KHÔNG được lọt vào log.
>
> **Bắt buộc mask `authorization`:** AI service gửi `Authorization: Bearer <OPENROUTER_API_KEY | MUST1C_API_KEY>` — đây là tài sản nhạy cảm nhất của hệ thống.

### 5.3 Key pattern trong object (đệ quy mọi độ sâu)

Với mọi key trong object (header đã xử lý riêng, body/query/params/prompt), nếu key khớp pattern sau → mask giá trị:

```
/api[_-]?key/i, /secret/i, /token/i, /password/i, /passwd/i,
/authorization/i, /credential/i, /signature/i, /session/i, /sig$/i
```

Áp dụng **đệ quy** cho object lồng nhau và array — vì AI error response có thể echo lại body request kèm API key ở độ sâu bất kỳ.

### 5.4 Query param trong URL

Mask giá trị của các query param (cả trong `url` string lẫn `request.query` object):

```
api_key, apikey, key, token, access_token, auth, signature, sig,
X-Amz-Signature, X-Amz-Credential, X-Amz-Security-Token
```

Đồng thời mask **userinfo** trong URL (`https://user:pass@host` → `https://***REDACTED***@host`).

### 5.5 Reference Implementation (sanitizer)

Code tham chiếu cho `src/modules/external-log/services/external-log-sanitizer.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';

/**
 * Sanitizer: deep-clone + mask mọi bí mật trước khi ghi log.
 * KHÔNG bao giờ mutate object gốc (request config bị tái sử dụng ở anti-bot retry).
 */
@Injectable()
export class ExternalLogSanitizerService {
  /** Giá trị thay thế cố định (đúng tiêu chí nghiệm thu plan). */
  static readonly REDACTED = '***REDACTED***';

  /** Header nhạy cảm — so sánh case-insensitive. */
  private static readonly SENSITIVE_HEADERS = new Set([
    'authorization', 'proxy-authorization', 'x-api-key', 'api-key',
    'x-auth-token', 'x-access-token', 'x-goog-api-key', 'x-rapidapi-key',
    'x-firecrawl-api-key', 'x-csrf-token', 'x-xsrf-token', 'token',
    'cookie', 'set-cookie', 'session', 'secret',
  ]);

  /** Key pattern trong object — áp dụng đệ quy. */
  private static readonly SENSITIVE_KEY_PATTERNS: RegExp[] = [
    /api[_-]?key/i, /secret/i, /token/i, /password/i, /passwd/i,
    /authorization/i, /credential/i, /signature/i, /session/i, /sig$/i,
  ];

  /** Query param nhạy cảm trong URL. */
  private static readonly SENSITIVE_QUERY_PARAMS = new Set([
    'api_key', 'apikey', 'key', 'token', 'access_token', 'auth',
    'signature', 'sig', 'X-Amz-Signature', 'X-Amz-Credential', 'X-Amz-Security-Token',
  ]);

  /** Che header (nhận Record<string, any> — key có thể viết hoa/thường lẫn lộn). */
  sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      result[key] = ExternalLogSanitizerService.SENSITIVE_HEADERS.has(key.toLowerCase())
        ? ExternalLogSanitizerService.REDACTED
        : value;
    }
    return result;
  }

  /** Mask query param nhạy cảm trong URL string. */
  sanitizeUrl(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);
      // userinfo: https://user:pass@host
      if (url.username || url.password) {
        url.username = ExternalLogSanitizerService.REDACTED;
        url.password = ExternalLogSanitizerService.REDACTED;
      }
      for (const key of [...url.searchParams.keys()]) {
        if (ExternalLogSanitizerService.SENSITIVE_QUERY_PARAMS.has(key)) {
          url.searchParams.set(key, ExternalLogSanitizerService.REDACTED);
        }
      }
      return url.toString();
    } catch {
      return rawUrl; // URL không parse được → giữ nguyên (crawl URL thường hợp lệ)
    }
  }

  /** Deep-clone + mask key nhạy cảm ở mọi độ sâu. */
  sanitizeValue(value: any, depth = 0): any {
    if (depth > 10) return value; // chống stack overflow với object cực sâu
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item, depth + 1));
    }
    if (value !== null && typeof value === 'object') {
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(value)) {
        const isSensitive = ExternalLogSanitizerService.SENSITIVE_KEY_PATTERNS.some(
          (re) => re.test(key),
        );
        result[key] = isSensitive
          ? ExternalLogSanitizerService.REDACTED
          : this.sanitizeValue(val, depth + 1);
      }
      return result;
    }
    return value;
  }
}
```

### 5.6 Thứ tự xử lý tại logger service (Phase 2 phải tuân thủ)

```
raw response/error
  → 1. sanitize (headers, url, query, body, prompt, error.message)
  → 2. map usage snake_case → camelCase (AI)
  → 3. truncate body nếu vượt MAX_LOG_BODY_BYTES
  → 4. tạo document → fire-and-forget insert
```

---

## 6. Giới hạn kích thước payload (Truncation)

- Ngưỡng: `MAX_LOG_BODY_BYTES = 51200` (50KB) — từ `REQUEST_LOGGING_PLAN.md` (Phase 4).
- Cách cắt:
  - Body là **string** (HTML/RSS raw, text error): `body.length > 51200` → `body.substring(0, 51200)` + hậu tố `'...[TRUNCATED]'`.
  - Body là **object** (JSON AI response): `JSON.stringify` rồi cắt như string; nếu sau khi parse lại không cần — **lưu dạng string đã cắt** để tránh parse lại tốn CPU (ghi chú trong `metadata.truncatedBody = true` nếu dùng extension point).
- Áp dụng cho cả `request.body`, `response.body`, `request.prompt` (prompt AI có thể dài 60KB — `contentToAnalyze.substring(0, 60000)` trong `filterRawArticles`).
- `error.stack` cũng cắt ở 50KB (stack thường ngắn, nhưng phòng thủ).
- Header luôn nhỏ, không cần truncate.

---

## 7. Indexing & Retention Policy

### 7.1 Danh sách index (khai báo sau `SchemaFactory.createForClass`)

| # | Index | Kiểu | Mục đích |
|---|---|---|---|
| 1 | `{ type: 1, createdAt: -1 }` | compound | Query chính của màn hình Admin: lọc theo loại log (Crawl/AI) + sort mới nhất |
| 2 | `{ targetService: 1 }` | single | Lọc theo tên trang báo / AI provider (VD: tất cả log của `VnExpress`) |
| 3 | `{ statusCode: 1 }` | single | Lọc theo status (VD: toàn bộ `403` anti-bot — kịch bản QA trong plan) |
| 4 | `{ createdAt: 1 }` | **TTL** | `expireAfterSeconds: 2592000` — tự động xóa log sau **30 ngày** |

### 7.2 Retention policy — chi tiết

- **30 ngày** = `30 * 24 * 60 * 60 = 2592000` giây.
- MongoDB TTL monitor chạy **mỗi 60 giây** → log có thể tồn tại tối đa ~30 ngày + 60s sau khi hết hạn (chấp nhận được, ghi chú cho QA).
- **TTL index phải là single-field index trên trường `Date`** — không được ghép vào compound index.
- `createdAt` được tự động quản lý bởi option `timestamps` → TTL hoạt động ngay không cần code dọn dẹp thủ công.
- Nếu Phase 2 muốn retention linh hoạt theo env `LOG_RETENTION_DAYS`: tính `expireAfterSeconds = days * 86400` **tại thời điểm khai báo schema** (index được tạo lúc module init). Lưu ý: đổi giá trị sau khi index đã tồn tại trong MongoDB **không tự cập nhật** — cần drop/re-create index hoặc chấp nhận giá trị mặc định 30 ngày.

### 7.3 Cải tiến tùy chọn (không bắt buộc cho Phase 2)

- `{ targetService: 1, createdAt: -1 }` thay cho `{ targetService: 1 }` nếu Admin thường xuyên xem lịch sử theo từng trang báo (compound phục vụ cả filter + sort). Giữ `{ targetService: 1 }` đơn lẻ nếu muốn tối giản đúng spec.
- `{ sourceModule: 1 }` nếu cần thống kê theo module phát request.

---

## 8. Kiến trúc module `ExternalLogModule`

### 8.1 File layout đề xuất

```
RealEstateBackendApp/src/modules/external-log/
├── external-log.module.ts                        # Khai báo MongooseModule.forFeature + providers + exports
├── schemas/
│   └── external-request-log.schema.ts            # Schema (reference ở §4)
├── services/
│   ├── external-log.service.ts                   # Core: logCrawl() / logAi() / query() — fire-and-forget write
│   ├── external-log-sanitizer.service.ts         # Sanitize + mask + truncate (reference ở §5.5)
│   ├── crawl-logger.service.ts                   # (Phase 2) Wrapper/interceptor cho CustomCrawlerService/FirecrawlService
│   └── ai-logger.service.ts                      # (Phase 2) Wrapper cho AIFilterService/AiPromptConfigService
├── controllers/
│   └── external-log.controller.ts                # GET /api/v1/external-logs, GET /api/v1/external-logs/:id
└── dtos/
    ├── query-external-log.dto.ts                 # Filter + phân trang (class-validator)
    └── (tùy chọn) external-log-response.dto.ts   # Shape response chuẩn hóa
```

### 8.2 `external-log.module.ts` — reference

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ExternalRequestLog,
  ExternalRequestLogSchema,
} from './schemas/external-request-log.schema';
import { ExternalLogService } from './services/external-log.service';
import { ExternalLogSanitizerService } from './services/external-log-sanitizer.service';
import { ExternalLogController } from './controllers/external-log.controller';

/**
 * Ghi log tập trung cho mọi outgoing request (crawl + AI).
 * Export ExternalLogService để module khác (news-fire-crawl-manager) inject.
 * Không @Global — import tường minh để lộ rõ dependency graph.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExternalRequestLog.name, schema: ExternalRequestLogSchema },
    ]),
  ],
  controllers: [ExternalLogController],
  providers: [ExternalLogService, ExternalLogSanitizerService],
  exports: [ExternalLogService],
})
export class ExternalLogModule {}
```

> Cân nhắc: nếu sau này có nhiều module cần log (wordpress, notification…), có thể chuyển sang `@Global()`. Với Phase 2 chỉ cần `news-fire-crawl-manager` dùng → **import tường minh** là đủ và rõ ràng hơn.

### 8.3 `ExternalLogService` — contract (reference)

```typescript
@Injectable()
export class ExternalLogService {
  // Ghi log crawl — gọi từ choke point crawl (xem §9)
  logCrawl(input: {
    targetService: string;      // tên trang báo
    url: string;
    method: string;
    statusCode?: number;
    durationMs: number;
    requestHeaders?: Record<string, any>;
    requestQuery?: Record<string, any>;
    requestBody?: any;
    responseHeaders?: Record<string, any>;
    responseBody?: any;
    error?: { message?: string; code?: string; stack?: string };
    metadata?: Record<string, any>;
  }): void;

  // Ghi log AI — gọi từ choke point AI (xem §9)
  logAi(input: {
    provider: string;           // 'OpenRouter' | 'Must1c'
    model?: string;             // → metadata.model
    url: string;
    method: string;
    statusCode?: number;
    durationMs: number;
    prompt: string;             // → request.prompt
    requestHeaders?: Record<string, any>;
    requestBody?: any;          // payload chat/completions
    responseHeaders?: Record<string, any>;
    responseBody?: any;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    error?: { message?: string; code?: string; stack?: string };
    metadata?: Record<string, any>;
  }): void;

  // Query cho Admin API (§10) — trả PaginatedResult<ExternalRequestLog>
  findAll(filter: QueryExternalLogDto): Promise<PaginatedResult<ExternalRequestLog>>;
  findById(id: string): Promise<ExternalRequestLog | null>;
}
```

### 8.4 Luồng dữ liệu (text diagram)

```
[CustomCrawlerService.fetchWithAntiBotBypass]  ─┐
[FirecrawlService (nếu kích hoạt)]             ─┼─► ExternalLogService.logCrawl()
[AIFilterService.* (4 hàm fetch AI)]           ─┼─► ExternalLogService.logAi()
                                                 │
                                   ┌─────────────▼──────────────┐
                                   │ ExternalLogSanitizerService │
                                   │ sanitize → mask → truncate  │
                                   └─────────────┬──────────────┘
                                                 ▼
                                   ExternalRequestLogModel.create()
                                   (fire-and-forget, .catch() log lỗi)
                                                 ▼
                                   MongoDB collection: external_request_logs
                                                 ▲
                                   Admin UI query qua:
                                   GET /api/v1/external-logs (+ filter)
```

---

## 9. Bản đồ tích hợp với service hiện có

> Phase 2 phải log tại **choke point** — nơi duy nhất HTTP đi ra ngoài — để không bỏ sót request và không trùng lặp log.

### 9.1 Crawl — `CustomCrawlerService` (ACTIVE)

- **Choke point duy nhất:** `fetchWithAntiBotBypass(url)` (`custom-crawler.service.ts`).
  - Bao phủ CẢ nhánh RSS (`source.rssUrl`) lẫn nhánh AI Extractor HTML (`source.url`) — vì cả hai đều đi qua helper này.
  - `rss-parser.parseString()` chỉ parse string đã fetch, **không** tự gọi HTTP → không cần log ở đây.
  - Bao phủ luôn request retry anti-bot (cookie replay) — nên log **cả 2 lần gọi axios** (hoặc log 1 bản ghi tổng hợp với `metadata.retryCount`; đề xuất: log từng HTTP call để thấy rõ request nào 403).
- **Chi tiết bắt buộc:**
  - `targetService = source.name` (tên trang báo).
  - `statusCode` từ response; nếu axios throw → `error.code = err.code` (VD `ECONNABORTED`), và nếu `err.response` tồn tại (403 Cloudflare, 503…) → vẫn lưu `statusCode = err.response.status` + `response.body = err.response.data` (raw HTML error) — **đúng kịch bản QA trong plan**.
  - `response.body` là HTML/RSS string → truncate 50KB theo §6.
  - `request.prompt` để rỗng (không phải AI).
  - `metadata.urlHash` (nếu có) giúp truy vết bài viết.
- **Cách triển khai gợi ý:** inject `ExternalLogService` vào `CustomCrawlerService` và bọc quanh 2 lệnh `axios.get` trong `fetchWithAntiBotBypass` (đo `Date.now()` trước/sau, `finally` ghi log). Không cần axios interceptor toàn cục — tránh nhiễu log nội bộ.

### 9.2 AI — `AIFilterService` (ACTIVE)

- **4 điểm gọi HTTP ra AI provider** (đều dùng `fetch` native):
  1. `filterAndRank()` → OpenRouter `https://openrouter.ai/api/v1/chat/completions`
  2. `filterRawArticles()` → Must1c (`must1cApiUrl`) hoặc OpenRouter (theo `ACTIVE_AI_PLATFORM`)
  3. `cleanMarkdownContentWithAI()` → Must1c hoặc OpenRouter
  4. `callAiCompletion()` → Must1c hoặc OpenRouter
- **Cách triển khai gợi ý (2 lựa chọn, ưu tiên A):**
  - **(A) Extract helper chung `callChatCompletion(payload, providerConfig)`** — gom 4 điểm fetch thành 1 hàm private trong `AIFilterService` (hoặc service riêng), chịu trách nhiệm: fetch + đo thời gian + map `usage` (snake_case → camelCase) + gọi `ExternalLogService.logAi()`. Giảm 4 chỗ duplicate thành 1, log tự động bao phủ toàn bộ.
  - **(B) Tối thiểu xâm lấn:** inject `ExternalLogService` và bọc từng điểm fetch hiện có. Chấp nhận duplicate nhưng không refactor.
- **Chi tiết bắt buộc:**
  - `targetService = 'OpenRouter' | 'Must1c'` (theo nhánh đang chạy).
  - `request.prompt` = prompt đầy đủ (system + content đã ghép).
  - `request.body` = payload `{ model, messages }` gửi đi.
  - `response.usage` = map từ `data.usage` (`prompt_tokens` → `promptTokens`, …); nếu provider không trả usage → để `0`.
  - Lỗi: `!res.ok` → vẫn log `statusCode` + `response.body` = error body text (VD Must1c parse `error.message`); `AbortError` (timeout 300s) → `error.code = 'AbortError'`, `error.message = 'AI API request timed out after 300 seconds'`.

### 9.3 `FirecrawlService` (COMMENTED OUT — chuẩn bị)

- File hiện tại bị comment toàn bộ. Nếu Phase 2/3 kích hoạt lại: SDK `FirecrawlApp` không lộ axios instance → log ở mức gọi SDK (`scrapeUrl`, `extract`): lấy `targetService = source.name`, `url`, `statusCode` từ `result.success`/`result.statusCode`, `response.body = result.data`. Ghi chú cho Phase 2 nhưng **không bắt buộc implement ngay**.

### 9.4 `AiPromptConfigService` (KHÔNG cần log)

- Chỉ đọc prompt config từ file JSON, không gọi HTTP → nằm ngoài phạm vi. Nếu muốn truy vết prompt nào được dùng, ghi `metadata.promptName` ở tầng caller (AIFilterService).

### 9.5 Đăng ký module

`NewsFireCrawlManagerModule` (hoặc `AppModule`) thêm:
```typescript
imports: [..., ExternalLogModule]
```
và `ExternalLogService` inject vào `CustomCrawlerService`, `AIFilterService`.

---

## 10. Admin Query API (contract cho Phase 2)

> Chỉ phục vụ Admin — KHÔNG phải nguồn log nội bộ. Nếu hệ thống có auth guard thì gắn guard admin (hiện tại chưa có auth — theo `audit-log.schema.ts` actor `'system'`).

### 10.1 `GET /api/v1/external-logs`

Query params (DTO `QueryExternalLogDto`, dùng class-validator — convention dự án):

| Param | Kiểu | Bắt buộc | Ghi chú |
|---|---|---|---|
| `type` | enum | ❌ | `CRAWL_OUTGOING` \| `AI_OUTGOING` |
| `targetService` | string | ❌ | Tìm chính xác tên trang/provider |
| `statusCode` | number | ❌ | 100–599 |
| `startDate` | string | ❌ | ISO 8601, filter `createdAt >= startDate` |
| `endDate` | string | ❌ | ISO 8601, filter `createdAt <= endDate` |
| `page` | number | ❌ | ≥ 1, default theo `normalizePagination` (common util dự án) |
| `limit` | number | ❌ | 1–100, default theo `normalizePagination` |
| `sort` | string | ❌ | `'newest'` (default) \| `'oldest'` — sort theo `createdAt` |

Response: `PaginatedResult<ExternalRequestLog>` — dùng sẵn `common/dto/paginated-response.dto` + `common/utils/pagination.util` (`normalizePagination`) như các controller hiện có.

```typescript
// dtos/query-external-log.dto.ts — reference
import { IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ExternalRequestType } from '../schemas/external-request-log.schema';

export class QueryExternalLogDto {
  @IsOptional()
  @IsEnum(ExternalRequestType)
  type?: ExternalRequestType;

  @IsOptional()
  @IsString()
  targetService?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest';
}
```

### 10.2 `GET /api/v1/external-logs/:id`

- Validate `:id` là ObjectId hợp lệ (dùng `Types.ObjectId.isValid`) → sai trả `400`.
- Không tìm thấy → `404`.
- Trả document đầy đủ (kể cả `error.stack`, `response.body`) — dữ liệu đã được sanitize lúc ghi nên an toàn để hiển thị.

---

## 11. Biến môi trường

| Env var | Default | Mô tả |
|---|---|---|
| `ENABLE_EXTERNAL_LOGGING` | `true` | Bật/tắt hoàn toàn việc ghi log (false → logger early-return, không tốn CPU sanitize) |
| `LOG_RETENTION_DAYS` | `30` | Số ngày giữ log → `expireAfterSeconds = days * 86400` (tính lúc khai báo index) |
| `MAX_LOG_BODY_BYTES` | `51200` | Ngưỡng truncate body (50KB) |

> Phase 2 đọc qua `ConfigService` như convention dự án (`configService.get<string>('LOG_RETENTION_DAYS')`). Các giá trị trên nằm trong `REQUEST_LOGGING_PLAN.md` Phase 4 — Phase 2 có thể khai báo sẵn với default an toàn.

---

## 12. Xử lý lỗi & cơ chế Fire-and-forget

- **Bắt buộc fire-and-forget** (theo plan: *"Async Non-blocking để tuyệt đối không làm chậm tốc độ crawl và tốc độ xử lý AI"*):
  ```typescript
  // Reference — KHÔNG await, KHÔNG re-throw
  void this.externalRequestLogModel
    .create(doc)
    .catch((err) => this.logger.error(`Ghi external log thất bại: ${err.message}`, err.stack));
  ```
- Tuân thủ pattern `AuditLogService.log()` hiện có: lỗi ghi log chỉ ghi vào `Logger`, **không bao giờ** lan ra ngoài làm hỏng operation chính (crawl/AI vẫn phải chạy tiếp).
- `ENABLE_EXTERNAL_LOGGING=false` → early return ngay từ đầu hàm log (trước cả sanitize).
- Sanitizer lỗi cũng phải được bọc try/catch ở Phase 2: nếu sanitize fail vì dữ liệu lạ, log raw (kèm cảnh báo) thay vì mất log — ưu tiên có log hơn là không có log, nhưng vẫn cố gắng mask trước.

---

## 13. Ví dụ document mẫu

### 13.1 Crawl log (403 anti-bot — kịch bản QA)

```json
{
  "type": "CRAWL_OUTGOING",
  "targetService": "VnExpress",
  "method": "GET",
  "url": "https://vnexpress.net/rss/thoi-su.rss",
  "statusCode": 403,
  "durationMs": 1842,
  "request": {
    "headers": { "User-Agent": "Mozilla/5.0 ... Chrome/120.0.0.0 Safari/537.36" },
    "query": {},
    "params": {},
    "body": null,
    "prompt": ""
  },
  "response": {
    "headers": { "content-type": "text/html", "set-cookie": "***REDACTED***" },
    "body": "<html>...Cloudflare challenge...</html>",
    "usage": { "promptTokens": 0, "completionTokens": 0, "totalTokens": 0 }
  },
  "error": {
    "message": "Request failed with status code 403",
    "code": "ERR_BAD_RESPONSE",
    "stack": "AxiosError: Request failed with status code 403\n    at ..."
  },
  "sourceModule": "CustomCrawlerService",
  "metadata": { "retryCount": 1 },
  "createdAt": "2026-08-03T09:15:00.000Z"
}
```

### 13.2 AI log (OpenRouter thành công)

```json
{
  "type": "AI_OUTGOING",
  "targetService": "OpenRouter",
  "method": "POST",
  "url": "https://openrouter.ai/api/v1/chat/completions",
  "statusCode": 200,
  "durationMs": 8430,
  "request": {
    "headers": { "Authorization": "***REDACTED***", "Content-Type": "application/json" },
    "query": {},
    "params": {},
    "body": { "model": "google/gemini-2.5-flash", "messages": [{ "role": "user", "content": "..." }] },
    "prompt": "FILTER_AND_RANK_PROMPT...URL: https://...Title: ..."
  },
  "response": {
    "headers": { "content-type": "application/json" },
    "body": { "choices": [{ "message": { "content": "[{\"url\":\"...\",\"rank\":1}]" } }] },
    "usage": { "promptTokens": 4500, "completionTokens": 320, "totalTokens": 4820 }
  },
  "error": null,
  "sourceModule": "AIFilterService",
  "metadata": { "model": "google/gemini-2.5-flash" },
  "createdAt": "2026-08-03T09:20:00.000Z"
}
```

---

## 14. Tiêu chí nghiệm thu

(Ánh xạ từ `REQUEST_LOGGING_PLAN.md` → Verification Criteria)

1. 100% Crawl Outgoing Request được ghi log với đầy đủ Target URL, Status Code, Duration.
2. 100% AI Outgoing Request được ghi log với đầy đủ Model, Prompt, Response, Token Usage.
3. Không ghi bất kỳ API Request nội bộ nào từ Client/Admin/Mobile App (không dùng interceptor toàn cục).
4. API Key / Secret Header được che chắn an toàn — giá trị hiển thị đúng `***REDACTED***` (kiểm tra DB trực tiếp: không tồn tại chuỗi key thật trong bất kỳ document nào).
5. Log cũ tự động biến mất sau 30 ngày (TTL) — test bằng cách set `expireAfterSeconds` nhỏ tạm thời.
6. Body > 50KB bị truncate, không làm phình collection.
7. Khi crawl 403 anti-bot → log bắt được status 403 kèm raw HTML error (kịch bản QA).
8. Khi AI trả lỗi/invalid key → log ghi đủ `error.stack` + `statusCode`.
9. Ghi log không làm chậm crawl/AI (fire-and-forget) — crawl batch vẫn hoàn thành đúng thời gian dự kiến.

---

## 15. Checklist cho Phase 2 (`coder-backend-agent`)

- [ ] Tạo module `ExternalLogModule` theo layout §8.1, đăng ký schema vào `MongooseModule.forFeature` (§8.2).
- [ ] Copy schema reference §4 (giữ nguyên: timestamps createdAt-only, enum, index sau `createForClass`, TTL `expireAfterSeconds: 2592000`, `collection: 'external_request_logs'`).
- [ ] Implement `ExternalLogSanitizerService` theo §5.5 (deep-clone, không mutate gốc, mask header/key/query/cookie, mask URL userinfo).
- [ ] Implement `ExternalLogService` theo contract §8.3: `logCrawl()`, `logAi()`, `findAll()`, `findById()` — fire-and-forget §12, đọc env §11 qua `ConfigService`.
- [ ] Map `usage` snake_case → camelCase tại logger AI.
- [ ] Truncate body theo §6 (`MAX_LOG_BODY_BYTES`).
- [ ] Tích hợp `CustomCrawlerService.fetchWithAntiBotBypass` (§9.1): log cả 2 lần gọi axios, xử lý `err.response` (403 + raw HTML), `targetService = source.name`.
- [ ] Tích hợp `AIFilterService` (§9.2): ưu tiên extract helper chung `callChatCompletion`; log provider/model/prompt/usage/error; `AbortError` timeout.
- [ ] Import `ExternalLogModule` vào module sử dụng; inject `ExternalLogService`.
- [ ] Implement Admin API §10: `GET /api/v1/external-logs` (DTO validate + `normalizePagination` + `PaginatedResult`) và `GET /api/v1/external-logs/:id` (400/404).
- [ ] Unit test: sanitizer (mask đủ mọi pattern, không mutate gốc), truncate, mapping usage, fire-and-forget không re-throw.
- [ ] Kiểm thử tay 2 kịch bản QA: crawl 403 anti-bot có log kèm HTML error; AI invalid key có log kèm stack.
