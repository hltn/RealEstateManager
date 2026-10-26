import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';

/** Thông báo mặc định khi bị chuyển đi vì không đủ quyền. */
export const NO_PERMISSION_MESSAGE = 'Bạn không có quyền vào trang này.';

/** Cùng `id` nên StrictMode/chuyển hướng liên tiếp chỉ hiện đúng 1 thông báo. */
const NOTICE_TOAST_ID = 'redirect-notice';

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
    toast.error(message, { id: NOTICE_TOAST_ID });
  }, [message]);

  return <Navigate to={to} replace />;
};

export default RedirectWithNotice;
