/**
 * Hook điều khiển hộp thoại mời bật thông báo (FR-28, Architecture 6.4).
 * - Hiện đúng một lần trên mỗi thiết bị: sau khi có kết quả (`enabled | skipped | denied`) thì ghi localStorage, lần sau không hỏi.
 * - Chỉ gọi API cấu hình push khi đã đủ điều kiện cục bộ (`isPushOptInLocallyEligible`), nên tab trình duyệt thường không tốn request.
 * - "Bật" gọi `enable()` của `usePushSubscription` NGAY trong handler bấm (không `await` gì trước), giữ cử chỉ người dùng cho iOS.
 */
import { useRef, useState } from 'react';
import { usePushSubscription } from '@crm/hooks/usePushSubscription';
import { useAuth } from '../hooks/useAuth';
import { readInstallEnvironment } from './iosInstallHintLogic';
import { readPermission } from './pushClient';
import { isPushOptInLocallyEligible, resolvePushOptInOutcome, shouldShowPushOptIn } from './pushOptInLogic';
import { readPushOptInChoice, savePushOptInChoice, type PushOptInChoice } from './pushOptInStorage';

/** `ask`: mời bật; `denied`: trình duyệt vừa từ chối quyền nên chỉ hướng dẫn mở lại quyền, không hỏi lại. */
export type PushOptInPhase = 'ask' | 'denied';

export interface UsePushOptInResult {
  isOpen: boolean;
  phase: PushOptInPhase;
  /** Đang đăng ký thông báo (nút "Bật" bị khóa, không đóng được hộp trong lúc trình duyệt đang hỏi quyền). */
  isBusy: boolean;
  /** Lỗi của lần bật gần nhất (không phải từ chối quyền); hộp vẫn mở để thử lại hoặc "Để sau". */
  error: string | null;
  /** Gọi TRỰC TIẾP trong handler bấm nút "Bật". */
  enable: () => Promise<void>;
  /** "Để sau": ghi `skipped` và đóng. */
  skip: () => void;
  /** Đóng hộp (Esc, "Đã hiểu"): ở bước hướng dẫn thì chỉ đóng, ở bước mời thì tính là "Để sau". */
  close: () => void;
}

export const usePushOptIn = (): UsePushOptInResult => {
  const { isAuthenticated } = useAuth();
  // Chế độ standalone không đổi trong phiên nên đọc một lần.
  const [isStandalone] = useState<boolean>(() => readInstallEnvironment().isStandalone);
  const [storedChoice, setStoredChoice] = useState<PushOptInChoice | null>(readPushOptInChoice);
  const [phase, setPhase] = useState<PushOptInPhase>('ask');
  // Chặn bấm lặp "Bật" trong cùng một nhịp trước khi `isBusy` kịp khóa nút.
  const isEnablingRef = useRef(false);

  // Đã mời trong phiên này: chốt lúc hộp mở để việc đọc lại quyền sau khi người dùng tương tác (vd vừa cấp quyền nhưng server lỗi)
  // không làm hộp biến mất. Hộp chỉ đóng khi có kết quả được ghi (`storedChoice`).
  const [isOffered, setIsOffered] = useState(false);
  const isSessionOpen = isOffered && storedChoice === null;

  const permission = readPermission();
  const localConditions = { isAuthenticated, isStandalone, permission, storedChoice };
  const push = usePushSubscription({ isActive: isPushOptInLocallyEligible(localConditions) || isSessionOpen });

  const persist = (choice: PushOptInChoice) => {
    savePushOptInChoice(choice);
    setStoredChoice(choice);
  };

  // Bước hướng dẫn luôn giữ hộp mở dù kết quả `denied` đã được ghi (nếu không hộp sẽ biến mất trước khi người dùng đọc).
  const isEligibleToOffer = shouldShowPushOptIn({ ...localConditions, isServerEnabled: push.isAvailable, isDeviceReady: push.state === 'ready' });
  // Chốt "đã mời" ngay lúc đủ điều kiện (đặt state trong lúc render là mẫu hợp lệ của React, không gây nháy hộp).
  if (isEligibleToOffer && !isOffered) setIsOffered(true);
  const isOpen = phase === 'denied' || isEligibleToOffer || isSessionOpen;

  const enable = async (): Promise<void> => {
    if (isEnablingRef.current) return;
    isEnablingRef.current = true;
    try {
      // `enable()` xin quyền ngay lập tức, nên PHẢI là lệnh bất đồng bộ đầu tiên của handler.
      const registration = await push.enable();
      const outcome = resolvePushOptInOutcome({ isRegistered: registration !== null, permission: readPermission() });
      if (outcome === 'enabled') {
        persist('enabled');
      } else if (outcome === 'denied') {
        persist('denied');
        setPhase('denied');
      }
      // `failed`: không ghi gì; hộp giữ mở nhờ `isOffered` (kể cả khi quyền đã chuyển sang granted) kèm `push.error` để thử lại hoặc "Để sau".
    } finally {
      isEnablingRef.current = false;
    }
  };

  const skip = () => persist('skipped');

  const close = () => {
    if (push.isBusy) return;
    if (phase === 'denied') setPhase('ask');
    else skip();
  };

  return { isOpen, phase, isBusy: push.isBusy, error: push.error, enable, skip, close };
};
