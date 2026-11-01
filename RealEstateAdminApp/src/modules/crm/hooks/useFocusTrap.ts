import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Giữ tiêu điểm bàn phím BÊN TRONG một hộp thoại: lúc mở chuyển tiêu điểm vào phần tử `data-autofocus` (hoặc phần tử nhập đầu tiên),
 * Tab/Shift+Tab xoay vòng trong hộp, đóng thì trả tiêu điểm về nút đã mở hộp. Nếu nút đó đã bị gỡ khỏi DOM (vd hàng vừa bị xóa/khôi phục)
 * thì chuyển tiêu điểm vào vùng ổn định đầu tiên đánh dấu `data-focus-fallback` (kèm `tabIndex={-1}`) thay vì để rơi về BODY.
 * Gắn `ref` vào phần tử gốc của hộp (mount khi mở).
 */
export const useFocusTrap = <T extends HTMLElement>() => {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    // BODY nghĩa là chưa có phần tử nào giữ tiêu điểm (vd nút mở đã bị gỡ trước khi hộp mở): coi như không có nơi để trả về.
    const previouslyFocused = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const getFocusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    (container.querySelector<HTMLElement>('[data-autofocus]') ?? getFocusable()[0] ?? container).focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      else document.querySelector<HTMLElement>('[data-focus-fallback]')?.focus();
    };
  }, []);

  return containerRef;
};
