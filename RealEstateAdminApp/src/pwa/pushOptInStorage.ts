/**
 * Lưu kết quả hộp thoại mời bật thông báo (FR-28), RIÊNG THEO THIẾT BỊ (localStorage, không theo tài khoản).
 * Theo mẫu `pushStorage.ts`: localStorage lỗi (private mode, quota) thì đọc như chưa có, ghi thì bỏ qua.
 */

export const PUSH_OPT_IN_CHOICE_KEY = 'push.optInChoice';

/**
 * - `enabled`: người dùng bấm "Bật" và đăng ký thành công.
 * - `skipped`: bấm "Để sau" (hoặc đóng hộp bằng Esc/nhấp nền).
 * - `denied`: bấm "Bật" nhưng trình duyệt từ chối quyền.
 */
export type PushOptInChoice = 'enabled' | 'skipped' | 'denied';

const CHOICES: readonly PushOptInChoice[] = ['enabled', 'skipped', 'denied'];

const isPushOptInChoice = (value: string | null): value is PushOptInChoice => CHOICES.some((choice) => choice === value);

/** Kết quả đã ghi; chưa ghi, giá trị lạ hoặc localStorage lỗi đều coi như chưa hỏi (`null`). */
export const readPushOptInChoice = (): PushOptInChoice | null => {
  try {
    const raw = localStorage.getItem(PUSH_OPT_IN_CHOICE_KEY);
    return isPushOptInChoice(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const savePushOptInChoice = (choice: PushOptInChoice): void => {
  try {
    localStorage.setItem(PUSH_OPT_IN_CHOICE_KEY, choice);
  } catch {
    // Bỏ qua: lần mở app sau chỉ hỏi lại; phiên hiện tại đã nhớ lựa chọn trong state.
  }
};
