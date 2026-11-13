/**
 * Bắt sự kiện `beforeinstallprompt` của Chrome/Edge (Android, máy tính) ở CẤP MODULE (FR-27).
 * Sự kiện chỉ bắn một lần, thường TRƯỚC khi React render màn đăng nhập, nên listener phải gắn sớm
 * (`startInstallPromptCapture()` được gọi ở đầu `main.tsx`) và giữ lại để nút "Android" gọi `prompt()` khi người dùng bấm.
 * Không phụ thuộc React: component đọc qua `subscribeInstallPrompt` + `hasCapturedInstallPrompt` (useSyncExternalStore).
 */

/** Kiểu sự kiện chưa có trong lib.dom của TypeScript. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/** `unavailable`: chưa có prompt đã bắt (hoặc `prompt()` lỗi) nên người gọi nên hiện hướng dẫn dự phòng. */
export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

let capturedPrompt: BeforeInstallPromptEvent | null = null;
/** Đã cài xong trong phiên này (sự kiện `appinstalled`): hướng dẫn cài Android không còn đúng nữa. */
let isInstalled = false;
let stopCapture: (() => void) | null = null;
const listeners = new Set<() => void>();

const notifyListeners = () => {
  for (const listener of listeners) listener();
};

/**
 * Gắn listener `beforeinstallprompt` và `appinstalled` lên `target`. Idempotent: gọi lại khi đã bắt thì không gắn trùng.
 * `preventDefault()` chặn mini-infobar mặc định để giữ sự kiện cho nút của mình. Trả về hàm gỡ listener (dùng cho test).
 */
export const startInstallPromptCapture = (target: Window = window): (() => void) => {
  if (stopCapture) return stopCapture;

  const handleBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    capturedPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  };
  // Đã cài xong thì prompt cũ vô nghĩa.
  const handleAppInstalled = () => {
    capturedPrompt = null;
    isInstalled = true;
    notifyListeners();
  };

  target.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  target.addEventListener('appinstalled', handleAppInstalled);
  stopCapture = () => {
    target.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    target.removeEventListener('appinstalled', handleAppInstalled);
    stopCapture = null;
    capturedPrompt = null;
    isInstalled = false;
    notifyListeners();
  };
  return stopCapture;
};

export const hasCapturedInstallPrompt = (): boolean => capturedPrompt !== null;

/** Đã nhận `appinstalled` trong phiên này (dùng để ẩn nút Android, tránh hướng dẫn cài lại app đã cài). */
export const hasInstalledApp = (): boolean => isInstalled;

/** Đăng ký nhận thông báo khi trạng thái prompt đổi; trả về hàm hủy đăng ký (khớp chữ ký `subscribe` của useSyncExternalStore). */
export const subscribeInstallPrompt = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Hiện hộp thoại cài của trình duyệt bằng prompt đã bắt. Phải gọi trực tiếp trong handler bấm (cần cử chỉ người dùng).
 * Mỗi sự kiện chỉ `prompt()` được một lần nên luôn bỏ prompt sau khi dùng (Chrome sẽ bắn sự kiện mới khi đủ điều kiện).
 */
export const promptInstall = async (): Promise<InstallPromptOutcome> => {
  const prompt = capturedPrompt;
  if (!prompt) return 'unavailable';
  capturedPrompt = null;
  notifyListeners();
  try {
    await prompt.prompt();
    return (await prompt.userChoice).outcome;
  } catch {
    return 'unavailable';
  }
};
