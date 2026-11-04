import { NotificationType } from './notification.constants';

export interface TypePreference {
  push: boolean;
  inApp: boolean;
}

export type TypePreferences = Record<NotificationType, TypePreference>;

export interface QuietHoursValue {
  start: string;
  end: string;
}

/** Mặc định mỗi loại thông báo: bật cả push và hộp thông báo trong app. */
export const DEFAULT_TYPE_PREFERENCE: Readonly<TypePreference> = {
  push: true,
  inApp: true,
};

export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Trộn cài đặt đã lưu với mặc định cho MỌI loại thông báo (loại thiếu = mặc định; khóa lạ trong dữ liệu cũ bị bỏ).
 * Hàm thuần.
 */
export const resolveTypePreferences = (
  stored: Record<string, Partial<TypePreference>> | null | undefined,
): TypePreferences =>
  Object.fromEntries(
    Object.values(NotificationType).map((type) => [
      type,
      {
        push: stored?.[type]?.push ?? DEFAULT_TYPE_PREFERENCE.push,
        inApp: stored?.[type]?.inApp ?? DEFAULT_TYPE_PREFERENCE.inApp,
      },
    ]),
  ) as TypePreferences;

/** Có ghi thông báo vào hộp thông báo của người này không: chỉ khi họ chưa tắt `inApp` cho loại đó. */
export const isInAppEnabled = (
  stored: Record<string, Partial<TypePreference>> | null | undefined,
  type: NotificationType,
): boolean => stored?.[type]?.inApp !== false;

/** `start` và `end` phải khác nhau (khoảng rỗng vô nghĩa); qua nửa đêm (22:00 -> 06:00) là hợp lệ. */
export const isValidQuietHours = (value: QuietHoursValue): boolean =>
  TIME_OF_DAY_PATTERN.test(value.start) &&
  TIME_OF_DAY_PATTERN.test(value.end) &&
  value.start !== value.end;
