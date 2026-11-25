import { useEffect, useState } from 'react';

/**
 * Gọi `onLoadMore` khi phần tử "mốc" (sentinel) cuối danh sách lọt vào khung nhìn (cuộn tới cuối thì tải thêm).
 * Trả về callback ref để gắn vào phần tử mốc: `<li ref={sentinelRef} />`.
 * - `isEnabled = false` (hết danh sách, đang lỗi, đang tắt) thì không quan sát, tránh vòng lặp tải lại khi trang kế lỗi.
 * - `onLoadMore` đổi tham chiếu (vd đang tải xong) thì observer dựng lại và báo ngay nếu mốc vẫn còn trong khung nhìn,
 *   nên danh sách ngắn hơn khung nhìn vẫn tự tải tiếp cho tới khi lấp đầy. Phía gọi tự chống gọi trùng.
 * - Môi trường không có `IntersectionObserver` (SSR, jsdom): không làm gì.
 */
export const useLoadMoreOnVisible = (onLoadMore: () => void, isEnabled: boolean) => {
  const [sentinel, setSentinel] = useState<Element | null>(null);

  useEffect(() => {
    if (!isEnabled || !sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: '200px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, isEnabled, onLoadMore]);

  return setSentinel;
};
