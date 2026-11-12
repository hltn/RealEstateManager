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

/** Người này có bật push cho loại đó không (mặc định bật; chỉ `push === false` mới tắt). */
export const isPushEnabled = (
  stored: Record<string, Partial<TypePreference>> | null | undefined,
  type: NotificationType,
): boolean => stored?.[type]?.push !== false;

/**
 * Giờ `nowVnHHmm` (định dạng `HH:mm`, ĐÃ quy về múi `Asia/Ho_Chi_Minh` bởi nơi gọi) có nằm trong giờ yên lặng không.
 * `start` BAO GỒM, `end` KHÔNG bao gồm; `start > end` là khung qua nửa đêm (22:00 đến 06:00). Hàm thuần.
 * `quietHours` rỗng (mặc định tắt), sai định dạng hoặc `start = end` thì luôn `false` (không bao giờ chặn nhầm push).
 */
export const isInQuietHours = (
  nowVnHHmm: string,
  quietHours: QuietHoursValue | null | undefined,
): boolean => {
  if (!quietHours || !TIME_OF_DAY_PATTERN.test(nowVnHHmm)) return false;
  if (!isValidQuietHours(quietHours)) return false;
  const { start, end } = quietHours;
  // `HH:mm` cùng độ dài nên so sánh chuỗi tương đương so sánh giờ.
  return start < end
    ? nowVnHHmm >= start && nowVnHHmm < end
    : nowVnHHmm >= start || nowVnHHmm < end;
};

/** `HH:mm` theo giờ Việt Nam (`Asia/Ho_Chi_Minh`, UTC+7 không DST) của một thời điểm; đầu vào cho `isInQuietHours`. */
export const toVnHHmm = (date: Date): string => {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(11, 16);
};

/** `start` và `end` phải khác nhau (khoảng rỗng vô nghĩa); qua nửa đêm (22:00 -> 06:00) là hợp lệ. */
export const isValidQuietHours = (value: QuietHoursValue): boolean =>
  TIME_OF_DAY_PATTERN.test(value.start) &&
  TIME_OF_DAY_PATTERN.test(value.end) &&
  value.start !== value.end;
