import { useEffect, useState } from 'react';

/** Phần đáy layout viewport đang bị bàn phím ảo che + chiều cao vùng nhìn thấy (px). */
export interface KeyboardInset {
  bottomPx: number;
  visibleHeightPx: number;
}

/** Dưới ngưỡng này coi là thanh địa chỉ co giãn của trình duyệt, không phải bàn phím -> không dịch sheet. */
const MIN_KEYBOARD_PX = 80;
/** Trên ngưỡng này coi là đang phóng to bằng tay (chừa sai số làm tròn). */
const MAX_NON_ZOOMED_SCALE = 1.05;

/**
 * Tính phần bị bàn phím ảo che ở đáy màn hình. iOS Safari KHÔNG co layout viewport khi hiện bàn phím (chỉ co `visualViewport`),
 * nên phần tử `fixed bottom-0` (bottom sheet) bị bàn phím đè lên, che luôn nút "Lưu".
 * Trả `null` khi không có bàn phím ảo / trình duyệt không có `visualViewport` (máy tính, jsdom) -> dùng CSS mặc định.
 */
export const computeKeyboardInset = (layoutHeightPx: number, viewport: Pick<VisualViewport, 'height' | 'offsetTop'> & { scale?: number }): KeyboardInset | null => {
  // Người dùng đang chụm (pinch) phóng to: `visualViewport.height` co lại do zoom chứ không phải do bàn phím -> không dịch sheet.
  if ((viewport.scale ?? 1) > MAX_NON_ZOOMED_SCALE) return null;
  const bottomPx = Math.max(0, Math.round(layoutHeightPx - viewport.height - viewport.offsetTop));
  return bottomPx >= MIN_KEYBOARD_PX ? { bottomPx, visibleHeightPx: Math.round(viewport.height) } : null;
};

export const useKeyboardInset = (isEnabled = true): KeyboardInset | null => {
  const [inset, setInset] = useState<KeyboardInset | null>(null);

  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
    if (!isEnabled || !viewport) return undefined;
    // Giữ nguyên object cũ khi số đo không đổi để `resize`/`scroll` liên tục (cuộn trong lúc bàn phím mở) không render lại vô ích.
    const update = () =>
      setInset((previous) => {
        const next = computeKeyboardInset(window.innerHeight, viewport);
        return previous?.bottomPx === next?.bottomPx && previous?.visibleHeightPx === next?.visibleHeightPx ? previous : next;
      });
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      setInset(null);
    };
  }, [isEnabled]);

  return inset;
};
