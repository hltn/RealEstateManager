import { createHash } from 'crypto';
import { PUSH_ENDPOINT_MAX_LENGTH } from './push-subscription.constants';

/**
 * Chính sách `endpoint` Web Push (FR-01, chống SSRF): server sẽ POST tới URL này nên chỉ nhận `https` tới đúng host của
 * dịch vụ push do trình duyệt cung cấp. Mục trong allowlist: `host` khớp chính xác, hoặc `*.host`/`.host` khớp mọi
 * tên miền con (không khớp chính tên miền gốc).
 */
export const DEFAULT_PUSH_ENDPOINT_HOST_ALLOWLIST: readonly string[] = [
  // Google FCM (Chrome, Edge/Brave trên Android...).
  'fcm.googleapis.com',
  // Mozilla autopush (Firefox): updates.push.services.mozilla.com và các nút khu vực.
  '*.push.services.mozilla.com',
  // Apple (Safari/PWA iOS): web.push.apple.com và các nút.
  '*.push.apple.com',
  // Microsoft WNS (Edge cũ): wns2-xxx.notify.windows.com.
  '*.notify.windows.com',
];

/** Độ dài khóa theo chuẩn: p256dh = điểm EC P-256 không nén (65 byte), auth = 16 byte. */
const P256DH_BYTES = 65;
const AUTH_BYTES = 16;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type PushEndpointCheck =
  | { valid: true; host: string }
  | { valid: false; reason: string };

/** Chuẩn hóa chuỗi cấu hình thành danh sách mục (bỏ trống, chữ thường, bỏ trùng). */
export const parseHostAllowlist = (raw: string | undefined | null): string[] =>
  Array.from(
    new Set(
      (raw ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    ),
  );

/**
 * Danh sách host cho phép = mặc định + `PUSH_ENDPOINT_HOST_ALLOWLIST` (bổ sung, phân tách bằng dấu phẩy) khi nhà cung
 * cấp đổi tên miền. Cố ý chỉ BỔ SUNG, không thay thế: cấu hình sai không làm tắt push của Chrome/Firefox/Safari.
 */
export const resolveHostAllowlist = (
  extraRaw: string | undefined | null,
): string[] =>
  Array.from(
    new Set([
      ...DEFAULT_PUSH_ENDPOINT_HOST_ALLOWLIST,
      ...parseHostAllowlist(extraRaw),
    ]),
  );

const hostMatches = (host: string, entry: string): boolean => {
  if (entry.startsWith('*.') || entry.startsWith('.')) {
    const suffix = entry.startsWith('*.') ? entry.slice(1) : entry;
    return host.length > suffix.length && host.endsWith(suffix);
  }
  return host === entry;
};

/**
 * Kiểm `endpoint`: độ dài, parse URL chuẩn (tránh lách bằng `@`, `\`, mã hóa %), bắt buộc `https`, không có
 * username/password, cổng mặc định (443), host thuộc allowlist. Lý do trả về là thông điệp cho dev, không chứa URL.
 */
export const checkPushEndpoint = (
  endpoint: string,
  allowlist: readonly string[],
): PushEndpointCheck => {
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    return { valid: false, reason: 'endpoint rỗng' };
  }
  if (endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) {
    return {
      valid: false,
      reason: `endpoint dài quá ${PUSH_ENDPOINT_MAX_LENGTH} ký tự`,
    };
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { valid: false, reason: 'endpoint không phải URL hợp lệ' };
  }
  if (url.protocol !== 'https:') {
    return { valid: false, reason: 'endpoint phải dùng https' };
  }
  if (url.username || url.password) {
    return {
      valid: false,
      reason: 'endpoint không được chứa thông tin đăng nhập',
    };
  }
  if (url.port !== '') {
    return { valid: false, reason: 'endpoint chỉ được dùng cổng mặc định 443' };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!allowlist.some((entry) => hostMatches(host, entry))) {
    return {
      valid: false,
      reason: 'host của endpoint không thuộc danh sách cho phép',
    };
  }
  return { valid: true, host };
};

const decodedBase64UrlLength = (value: string): number | null => {
  if (typeof value !== 'string' || !BASE64URL_PATTERN.test(value)) return null;
  return Buffer.from(value, 'base64url').length;
};

/** Kiểm khóa trình duyệt gửi lên: base64url, `p256dh` giải ra 65 byte (bắt đầu 0x04), `auth` giải ra 16 byte. */
export const checkPushKeys = (
  p256dh: string,
  auth: string,
): { valid: true } | { valid: false; reason: string } => {
  if (decodedBase64UrlLength(p256dh) !== P256DH_BYTES) {
    return { valid: false, reason: 'keys.p256dh sai định dạng hoặc độ dài' };
  }
  if (Buffer.from(p256dh, 'base64url')[0] !== 0x04) {
    return {
      valid: false,
      reason: 'keys.p256dh không phải điểm P-256 không nén',
    };
  }
  if (decodedBase64UrlLength(auth) !== AUTH_BYTES) {
    return { valid: false, reason: 'keys.auth sai định dạng hoặc độ dài' };
  }
  return { valid: true };
};

/** SHA-256 hex của `endpoint`: dùng trong AAD và log thay cho URL thô (URL là "capability"). */
export const computePushEndpointHash = (endpoint: string): string =>
  createHash('sha256').update(endpoint, 'utf8').digest('hex');

/** AAD gắn bản mã `auth` với người dùng và endpoint (Architecture 3.2). */
export const buildPushAuthAad = (
  userId: string,
  endpointHash: string,
): string => `${userId}:${endpointHash}:push`;

/** Dạng rút gọn của hash để ghi log (đủ để đối chiếu, không dựng lại được endpoint). */
export const shortEndpointHash = (endpointHash: string): string =>
  endpointHash.slice(0, 12);
