import { useEffect, useState, type RefObject } from 'react';

/** Chiều cao tối thiểu để danh sách còn dùng được (~3 dòng); thấp hơn thì cuộn ô nhập lên đầu vùng nhìn thấy. */
const MIN_LIST_HEIGHT_PX = 144;
const MAX_LIST_HEIGHT_PX = 256;
const BOTTOM_GAP_PX = 8;

export const clampListHeight = (availablePx: number): number => Math.round(Math.min(MAX_LIST_HEIGHT_PX, Math.max(MIN_LIST_HEIGHT_PX, availablePx)));

/**
 * Chiều cao tối đa của danh sách thả xuống sao cho KHÔNG bị bàn phím ảo che (iOS Safari không co layout viewport khi hiện bàn phím,
 * chỉ co `visualViewport`). Khi `isOpen`:
 * - tính chỗ trống từ đáy ô nhập tới đáy vùng nhìn thấy (visualViewport) và theo dõi khi bàn phím hiện/ẩn;
 * - nếu chỗ trống < `MIN_LIST_HEIGHT_PX` thì cuộn `containerRef` lên đầu vùng nhìn thấy (đúng 1 lần mỗi lần mở);
 * Trả `undefined` khi trình duyệt không có `visualViewport` (máy tính, jsdom) -> dùng chiều cao CSS mặc định.
 */
export const useVisibleListMaxHeight = (isOpen: boolean, anchorRef: RefObject<HTMLElement | null>, containerRef: RefObject<HTMLElement | null>): number | undefined => {
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!isOpen || !viewport) return undefined;
    let hasScrolled = false;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      // `getBoundingClientRect` tính theo layout viewport; `offsetTop` là độ lệch của vùng nhìn thấy so với layout viewport.
      const anchorBottom = anchor.getBoundingClientRect().bottom - viewport.offsetTop;
      const available = viewport.height - anchorBottom - BOTTOM_GAP_PX;
      setMaxHeight(clampListHeight(available));
      if (available < MIN_LIST_HEIGHT_PX && !hasScrolled) {
        hasScrolled = true;
        containerRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      }
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      setMaxHeight(undefined);
    };
  }, [isOpen, anchorRef, containerRef]);

  return maxHeight;
};
