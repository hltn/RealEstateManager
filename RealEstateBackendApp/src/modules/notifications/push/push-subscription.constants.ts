/** Số thiết bị Web Push còn hiệu lực tối đa của một người (FR-01, Architecture 5.6). */
export const PUSH_SUBSCRIPTION_MAX_PER_USER = 3;

/** Bản đã thu hồi được giữ 7 ngày (TTL `purgeAt`) để trang cài đặt báo "đã gỡ thiết bị X". */
export const PUSH_SUBSCRIPTION_REVOKED_RETENTION_DAYS = 7;

/** Độ dài tối đa của `endpoint` (Architecture 3.2). */
export const PUSH_ENDPOINT_MAX_LENGTH = 1024;

/** Giới hạn đăng ký: 10 yêu cầu mỗi phút mỗi người (tracker `userId`). */
export const PUSH_REGISTER_THROTTLE_LIMIT = 10;
export const PUSH_REGISTER_THROTTLE_TTL_MS = 60_000;

/** Nền tảng suy ra phía server từ `User-Agent` (không lưu UA thô). */
export enum PushPlatform {
  IOS = 'IOS',
  ANDROID = 'ANDROID',
  DESKTOP = 'DESKTOP',
  OTHER = 'OTHER',
}

/** Lý do thu hồi mềm. `GONE` = dịch vụ push trả 404/410; `LIMIT_EXCEEDED` = nhường chỗ thiết bị thứ 4. */
export enum PushRevokedReason {
  USER = 'USER',
  LOGOUT = 'LOGOUT',
  GONE = 'GONE',
  LIMIT_EXCEEDED = 'LIMIT_EXCEEDED',
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
}

export const PUSH_DEVICE_LABEL_MAX_LENGTH = 60;
