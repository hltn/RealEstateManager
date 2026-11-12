import { useEffect, type RefObject } from 'react';

/**
 * Đóng lớp nổi (dropdown) khi bấm ra ngoài `containerRef` hoặc nhấn Esc (T-57, FR-38; T-71 ý 4).
 * - Esc nghe ở `window` pha capture và gọi `preventDefault()` để thành phần nghe Esc ở `document` (ngăn kéo `AppSidebar`) thấy
 *   `event.defaultPrevented` mà không đóng đồng thời; xong trả focus về `restoreFocusRef` (nút chuông).
 * - Listener chỉ tồn tại khi `isOpen`; đóng hoặc unmount thì gỡ ngay.
 */
export const useDismissibleLayer = (isOpen: boolean, containerRef: RefObject<HTMLElement | null>, onClose: () => void, restoreFocusRef?: RefObject<HTMLElement | null>): void => {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
      restoreFocusRef?.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, containerRef, onClose, restoreFocusRef]);
};
