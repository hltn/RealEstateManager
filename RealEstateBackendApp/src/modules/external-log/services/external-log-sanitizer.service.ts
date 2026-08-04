import { Injectable } from '@nestjs/common';

/**
 * Sanitizer: deep-clone + mask mọi bí mật trước khi ghi log.
 * KHÔNG bao giờ mutate object gốc (request config bị tái sử dụng ở anti-bot retry).
 * Kèm truncation theo §6 spec: MAX_LOG_BODY_BYTES (mặc định 51200 = 50KB).
 */
@Injectable()
export class ExternalLogSanitizerService {
  /** Giá trị thay thế cố định (đúng tiêu chí nghiệm thu plan). */
  static readonly REDACTED = '***REDACTED***';

  /** Header nhạy cảm — so sánh case-insensitive. */
  private static readonly SENSITIVE_HEADERS = new Set([
    'authorization',
    'proxy-authorization',
    'x-api-key',
    'api-key',
    'x-auth-token',
    'x-access-token',
    'x-goog-api-key',
    'x-rapidapi-key',
    'x-firecrawl-api-key',
    'x-csrf-token',
    'x-xsrf-token',
    'token',
    'cookie',
    'set-cookie',
    'session',
    'secret',
  ]);

  /** Key pattern trong object — áp dụng đệ quy. */
  private static readonly SENSITIVE_KEY_PATTERNS: RegExp[] = [
    /api[_-]?key/i,
    /secret/i,
    /token/i,
    /password/i,
    /passwd/i,
    /authorization/i,
    /credential/i,
    /signature/i,
    /session/i,
    /sig$/i,
  ];

  /** Query param nhạy cảm trong URL. */
  private static readonly SENSITIVE_QUERY_PARAMS = new Set([
    'api_key',
    'apikey',
    'key',
    'token',
    'access_token',
    'auth',
    'signature',
    'sig',
    'X-Amz-Signature',
    'X-Amz-Credential',
    'X-Amz-Security-Token',
  ]);

  /** Che header (nhận Record<string, any> — key có thể viết hoa/thường lẫn lộn). */
  sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(headers ?? {})) {
      result[key] = ExternalLogSanitizerService.SENSITIVE_HEADERS.has(
        key.toLowerCase(),
      )
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
        const isSensitive =
          ExternalLogSanitizerService.SENSITIVE_KEY_PATTERNS.some((re) =>
            re.test(key),
          );
        result[key] = isSensitive
          ? ExternalLogSanitizerService.REDACTED
          : this.sanitizeValue(val, depth + 1);
      }
      return result;
    }
    return value;
  }

  /**
   * Truncate string theo §6: vượt maxBytes → cắt + hậu tố '...[TRUNCATED]'.
   * Áp dụng cho request.body, response.body, request.prompt, error.stack.
   */
  truncateString(value: string, maxBytes: number): string {
    if (value.length <= maxBytes) return value;
    return `${value.substring(0, maxBytes)}...[TRUNCATED]`;
  }

  /**
   * Truncate body theo §6:
   * - string (HTML/RSS raw, text error) → cắt như string.
   * - object (JSON AI response) → JSON.stringify rồi cắt; nếu bị cắt thì
   *   lưu dạng string đã cắt (tránh parse lại tốn CPU).
   * - null/undefined/primitive → giữ nguyên.
   */
  truncateBody(value: any, maxBytes: number): any {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
      return this.truncateString(value, maxBytes);
    }
    if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value);
        if (json.length <= maxBytes) return value;
        return this.truncateString(json, maxBytes);
      } catch {
        // Circular reference / serialize lỗi → fallback String() rồi cắt.
        return this.truncateString(String(value), maxBytes);
      }
    }
    return value;
  }
}
