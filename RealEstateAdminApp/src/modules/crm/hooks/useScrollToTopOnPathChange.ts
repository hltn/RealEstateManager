/**
 * Cuộn về đầu trang khi ĐỔI MÀN trong module CRM (pathname đổi): vd lưu form đã cuộn xuống rồi về chi tiết khách,
 * trang mới phải mở ở đầu chứ không giữ vị trí cuộn của màn trước. Cửa sổ trình duyệt là phần tử cuộn (layout Admin không có container riêng).
 * - Chỉ đổi query/hash (vd `?customerId=`): không cuộn.
 * - Back/Forward (POP): không cuộn, để trình duyệt tự khôi phục vị trí cũ.
 */
import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

export const useScrollToTopOnPathChange = (): void => {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    if (navigationType === 'POP') return;
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname, navigationType]);
};
