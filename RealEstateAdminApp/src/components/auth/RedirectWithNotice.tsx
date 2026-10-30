import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';

/** Thông báo mặc định khi bị chuyển đi vì không đủ quyền. */
export const NO_PERMISSION_MESSAGE = 'Bạn không có quyền vào trang này.';

/** Cùng `id` nên StrictMode/chuyển hướng liên tiếp chỉ hiện đúng 1 thông báo. */
const NOTICE_TOAST_ID = 'redirect-notice';

/** Thông báo xếp hàng chỉ có hiệu lực trong khoảng này (chuyển hướng xảy ra ngay sau khi xếp hàng). */
const QUEUED_NOTICE_TTL_MS = 10_000;

let queuedNotice: { message: string; expiresAt: number } | null = null;

/**
 * Báo trước: lần chuyển hướng kế tiếp là do CHÍNH người dùng vừa tự hạ quyền (vd Admin tự bỏ vai trò Quản trị), nên chỉ hiện
 * thông điệp này (dạng thành công) thay cho toast lỗi "không có quyền" mâu thuẫn với việc vừa lưu thành công.
 */
export const queueRedirectNotice = (message: string): void => {
  queuedNotice = { message, expiresAt: Date.now() + QUEUED_NOTICE_TTL_MS };
};

/** Thông báo đang xếp hàng nếu còn hạn (không xóa: effect của StrictMode chạy 2 lần trong dev). */
export const peekQueuedRedirectNotice = (): string | null => (queuedNotice && queuedNotice.expiresAt > Date.now() ? queuedNotice.message : null);

export const clearQueuedRedirectNotice = (): void => {
  queuedNotice = null;
};

interface RedirectWithNoticeProps {
  to: string;
  message?: string;
}

/**
 * Chuyển hướng (replace) kèm thông báo giải thích, thay cho `<Navigate>` im lặng khi người dùng gõ URL ngoài quyền.
 * Toast được bắn trong effect lúc mount; toast nằm ở `<Toaster>` gốc nên vẫn hiện sau khi màn hiện tại bị gỡ.
 */
const RedirectWithNotice: React.FC<RedirectWithNoticeProps> = ({ to, message = NO_PERMISSION_MESSAGE }) => {
  useEffect(() => {
    const queued = peekQueuedRedirectNotice();
    if (queued) {
      toast.success(queued, { id: NOTICE_TOAST_ID, duration: 6000 });
      setTimeout(clearQueuedRedirectNotice, 0);
    } else toast.error(message, { id: NOTICE_TOAST_ID });
  }, [message]);

  return <Navigate to={to} replace />;
};

export default RedirectWithNotice;
