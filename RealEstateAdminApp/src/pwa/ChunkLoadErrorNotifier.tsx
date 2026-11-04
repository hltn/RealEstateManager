import { useEffect } from 'react';
import toast from 'react-hot-toast';
import PwaToastCard from './PwaToastCard';

/** Id cố định: lỗi tải nhiều chunk cùng lúc vẫn chỉ hiện MỘT toast. */
export const CHUNK_ERROR_TOAST_ID = 'chunk-load-error';

/**
 * Sau một lần deploy, tab/PWA mở từ trước còn tham chiếu file JS/CSS có hash cũ đã bị xóa: `import()` động (React.lazy)
 * lỗi, Vite bắn `vite:preloadError`. Ở đây chặn lỗi mặc định (`preventDefault`) và nhắc người dùng tải lại bằng toast.
 * KHÔNG tự reload vì người dùng có thể đang gõ dở ghi chú. Màn hình lỗi cho vùng nội dung do `RouteErrorBoundary` lo.
 * Không render gì; gỡ listener khi unmount.
 */
const ChunkLoadErrorNotifier = () => {
  useEffect(() => {
    const handlePreloadError = (event: Event) => {
      event.preventDefault();
      toast.custom(
        (toastState) => (
          <PwaToastCard
            toastState={toastState}
            title="Ứng dụng đã có phiên bản mới"
            description="Không tải được một phần của trang. Hãy tải lại trang (lưu phần đang nhập trước)."
            dismissLabel="Đóng"
            confirmLabel="Tải lại"
            onConfirm={() => window.location.reload()}
          />
        ),
        { id: CHUNK_ERROR_TOAST_ID, duration: Infinity },
      );
    };

    window.addEventListener('vite:preloadError', handlePreloadError);
    return () => window.removeEventListener('vite:preloadError', handlePreloadError);
  }, []);

  return null;
};

export default ChunkLoadErrorNotifier;
