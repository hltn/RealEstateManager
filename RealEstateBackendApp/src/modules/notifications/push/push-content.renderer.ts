import { Logger } from '@nestjs/common';
import { redactPii } from '../../../common/logger/pii-redactor.util';
import {
  PUSH_ALLOWED_VARS,
  PUSH_CATALOG,
  PUSH_FALLBACK_BODY,
  PUSH_FALLBACK_TITLE,
  PushCatalogEntry,
  PushVarName,
} from './push-catalog';

/**
 * Dựng nội dung push an toàn PII (FR-06; Architecture 5.7). Hàm thuần: mẫu cố định của danh mục
 * + biến cho phép, cắt độ dài, quét PII hậu kiểm, `url` luôn là đường dẫn nội bộ.
 */

export const PUSH_TITLE_MAX_LENGTH = 50;
export const PUSH_BODY_MAX_LENGTH = 120;
/** Độ dài tối đa của một biến (tên dài bị cắt thêm `…` trước khi điền mẫu). */
export const PUSH_VAR_MAX_LENGTH = 30;
export const PUSH_URL_MAX_LENGTH = 200;
const ELLIPSIS = '…';
const OBJECT_ID = /^[a-f\d]{24}$/i;

export type PushVars = Partial<Record<PushVarName, string>>;

export interface PushRenderInput {
  /** Mã loại thông báo (loại ngoài danh mục rơi về nội dung dự phòng). */
  type: string;
  /** Chỉ các biến cho phép của loại; khóa lạ bị từ chối (ném `PushRenderError`). */
  vars?: Record<string, string | undefined>;
  /** Id khách (ObjectId) để dựng deep link từ mẫu. */
  customerId?: string;
  /** `data.deepLink` của thông báo; chỉ nhận khi là đường dẫn nội bộ hợp lệ. */
  deepLink?: string;
}

export interface PushRenderResult {
  title: string;
  body: string;
  /** Luôn bắt đầu bằng `/` (không `//`). */
  url: string;
  type: string;
  /** `true` khi dùng chuỗi dự phòng (loại lạ, thiếu biến hoặc PII bị chặn). */
  usedFallback: boolean;
}

export interface PushRenderLogger {
  error(message: string): void;
}

/** Biến ngoài danh sách cho phép (lỗi lập trình ở nơi gọi; không bao giờ kèm giá trị biến). */
export class PushRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PushRenderError';
  }
}

const defaultLogger: PushRenderLogger = new Logger('PushContentRenderer');

/** `url` nội bộ: bắt đầu `/`, không `//`, không `\`, không scheme, không ký tự điều khiển/khoảng trắng. */
export function isInternalPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= PUSH_URL_MAX_LENGTH &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !/[\\\s]/.test(value) &&
    !hasControlChar(value) &&
    !value.includes('://')
  );
}

function isControlChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

function hasControlChar(text: string): boolean {
  return Array.from(text).some(isControlChar);
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}${ELLIPSIS}`;
}

/** Làm sạch giá trị biến: bỏ ký tự điều khiển, ngoặc nhọn, gộp khoảng trắng. */
function cleanVar(value: string): string {
  return Array.from(value)
    .map((ch) => (isControlChar(ch) || ch === '{' || ch === '}' ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string | null {
  let missing = false;
  const out = template.replace(/\{([^{}]*)\}/g, (_m, name: string) => {
    const value = vars[name];
    if (!value) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? null : out;
}

function buildUrl(entry: PushCatalogEntry | undefined, input: PushRenderInput) {
  // `deepLink` có thể mang query string: bỏ nếu chứa PII (email, SĐT, CCCD), rơi về mẫu + id.
  if (
    isInternalPath(input.deepLink) &&
    redactPii(input.deepLink) === input.deepLink
  ) {
    return input.deepLink;
  }
  if (
    entry &&
    typeof input.customerId === 'string' &&
    OBJECT_ID.test(input.customerId)
  ) {
    const url = entry.deepLinkTemplate.replace(':id', input.customerId);
    if (isInternalPath(url)) return url;
  }
  return '/';
}

function fallbackResult(type: string, url: string): PushRenderResult {
  return {
    title: PUSH_FALLBACK_TITLE,
    body: PUSH_FALLBACK_BODY,
    url,
    type,
    usedFallback: true,
  };
}

export function renderPushContent(
  input: PushRenderInput,
  options: {
    catalog?: readonly PushCatalogEntry[];
    logger?: PushRenderLogger;
  } = {},
): PushRenderResult {
  const catalog = options.catalog ?? PUSH_CATALOG;
  const logger = options.logger ?? defaultLogger;
  const entry = catalog.find((e) => String(e.type) === input.type);
  const url = buildUrl(entry, input);

  // Loại ngoài danh mục: không có mẫu, chỉ lưới an toàn (Q12).
  if (!entry) return fallbackResult(input.type, url);

  const rawVars = input.vars ?? {};
  const cleaned: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawVars)) {
    if (
      !(PUSH_ALLOWED_VARS as readonly string[]).includes(name) ||
      !(entry.allowedVars as readonly string[]).includes(name)
    ) {
      throw new PushRenderError(`Biến "${name}" không được phép`);
    }
    if (typeof value !== 'string') continue;
    cleaned[name] = cleanVar(value);
  }

  // Quét PII trên giá trị ĐẦY ĐỦ trước khi cắt (cắt giữa SĐT/email có thể che mất dấu hiệu).
  const fullTitle = fillTemplate(entry.titleTemplate, cleaned);
  const fullBody = fillTemplate(entry.bodyTemplate, cleaned);
  if (fullTitle === null || fullBody === null) {
    logger.error(`Thiếu biến mẫu push, dùng nội dung dự phòng: ${entry.type}`);
    return fallbackResult(entry.type, url);
  }
  if (redactPii(fullTitle) !== fullTitle || redactPii(fullBody) !== fullBody) {
    logger.error(`Phát hiện PII trong nội dung push: ${entry.type}`);
    return fallbackResult(entry.type, url);
  }

  const truncatedVars: Record<string, string> = {};
  for (const [name, value] of Object.entries(cleaned)) {
    truncatedVars[name] = truncate(value, PUSH_VAR_MAX_LENGTH);
  }
  const title = truncate(
    fillTemplate(entry.titleTemplate, truncatedVars) ?? fullTitle,
    PUSH_TITLE_MAX_LENGTH,
  );
  const body = truncate(
    fillTemplate(entry.bodyTemplate, truncatedVars) ?? fullBody,
    PUSH_BODY_MAX_LENGTH,
  );

  // Hậu kiểm lần cuối trên kết quả cuối cùng.
  if (redactPii(title) !== title || redactPii(body) !== body) {
    logger.error(`Phát hiện PII sau khi cắt nội dung push: ${entry.type}`);
    return fallbackResult(entry.type, url);
  }
  return { title, body, url, type: entry.type, usedFallback: false };
}
