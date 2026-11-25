/**
 * Hook sao chép chữ + cờ `isCopied` tự tắt sau `resetMs` (mặc định 1.5s) để UI đổi icon Copy -> Check rồi quay lại.
 * Bấm lại khi đang hiện Check thì tính lại mốc 1.5s (không bị tắt sớm bởi lần trước). Dọn timer khi unmount, không setState sau unmount.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyTextToClipboard } from '@crm/lib/clipboard';

const COPIED_RESET_MS = 1500;

export const useCopyToClipboard = (resetMs: number = COPIED_RESET_MS) => {
  const [isCopied, setIsCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  /** Trả `true` nếu đã chép được; `false` thì không đổi icon (người dùng cần biết là chưa chép). */
  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      const isSuccess = await copyTextToClipboard(text);
      if (!isSuccess || !isMountedRef.current) return isSuccess;
      if (timerRef.current) clearTimeout(timerRef.current);
      setIsCopied(true);
      timerRef.current = setTimeout(() => setIsCopied(false), resetMs);
      return true;
    },
    [resetMs],
  );

  return { isCopied, copy };
};
