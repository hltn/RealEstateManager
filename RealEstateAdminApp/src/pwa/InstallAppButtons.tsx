import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Smartphone } from 'lucide-react';
import { DialogFrame } from '@crm/components/DialogFrame';
import { BUTTON_OUTLINE_LG_CLASS, BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';
import { IosInstallGuideText } from './IosInstallHint';
import { detectInstallPlatform, resolveInstallButtons } from './installPlatform';
import { hasCapturedInstallPrompt, hasInstalledApp, promptInstall, subscribeInstallPrompt } from './installPromptCapture';
import { isIosSafari, readInstallEnvironment } from './iosInstallHintLogic';

type GuideKind = 'ios' | 'android';

/**
 * Địa chỉ web hiển thị trong hướng dẫn. Hiện là origin của trang đang mở (không ghi cứng tên miền);
 * T-22 (FR-15) sẽ đổi thành `runtimeConfig.appUrl` (nếu trống thì rơi về origin) ngay tại hàm này.
 */
const resolveAppUrl = (): string => window.location.origin;

const GUIDE_TITLES: Record<GuideKind, string> = {
  ios: 'Cài ứng dụng trên iPhone/iPad',
  android: 'Cài ứng dụng trên Android',
};

interface InstallGuideDialogProps {
  kind: GuideKind | null;
  appUrl: string;
  /** iPhone/iPad nhưng KHÔNG phải Safari (Chrome, Zalo...): "Thêm vào MH chính" chỉ chắc chắn có ở Safari. */
  isNonSafariIos: boolean;
  onClose: () => void;
}

/** Hộp thoại hướng dẫn cài tay: iOS (Chia sẻ, Thêm vào MH chính) và Android khi trình duyệt chưa cho cài tự động. */
const InstallGuideDialog = ({ kind, appUrl, isNonSafariIos, onClose }: InstallGuideDialogProps) => {
  let body: ReactNode = null;
  if (kind === 'ios') {
    body = (
      <>
        <p>
          <IosInstallGuideText />
        </p>
        {isNonSafariIos && (
          <p>
            Trình duyệt hiện tại có thể không có mục này. Hãy mở địa chỉ bên dưới bằng <strong>Safari</strong> rồi làm lại.
          </p>
        )}
      </>
    );
  } else if (kind === 'android') {
    body = (
      <p>
        Trình duyệt chưa cho cài tự động. Mở địa chỉ bên dưới bằng <strong>Chrome</strong>, bấm menu <strong>⋮</strong> ở góc phải, rồi chọn{' '}
        <strong>Cài đặt ứng dụng</strong> (hoặc <strong>Thêm vào Màn hình chính</strong>).
      </p>
    );
  }

  return (
    <DialogFrame isOpen={kind !== null} title={kind ? GUIDE_TITLES[kind] : ''} onClose={onClose}>
      <div className="space-y-3 text-theme-sm leading-relaxed text-gray-600 dark:text-gray-400">
        {body}
        <p className="break-all rounded-lg bg-gray-50 px-3 py-2 font-medium text-gray-800 dark:bg-gray-800 dark:text-white/90" data-testid="install-app-url">
          {appUrl}
        </p>
      </div>
      <div className="flex justify-end pt-2">
        <button type="button" data-autofocus onClick={onClose} className={BUTTON_PRIMARY_CLASS}>
          Đã hiểu
        </button>
      </div>
    </DialogFrame>
  );
};

/**
 * Hai nút đưa web ra Màn hình chính điện thoại, đặt dưới form đăng nhập (FR-27).
 * - Android chỉ thấy nút Android, iOS/iPadOS chỉ thấy nút iOS, máy tính/không nhận ra thấy cả hai.
 * - Ẩn hẳn khi app đã chạy standalone (đã cài).
 * - Nút Android gọi prompt đã bắt ở `installPromptCapture`; chưa có prompt thì mở hướng dẫn dự phòng qua menu trình duyệt.
 * - Nút iOS mở hộp thoại hướng dẫn (iOS không cho web tự cài).
 */
const InstallAppButtons = () => {
  // Môi trường không đổi trong phiên nên đọc một lần.
  const [environment] = useState(readInstallEnvironment);
  const [openGuide, setOpenGuide] = useState<GuideKind | null>(null);
  const hasPrompt = useSyncExternalStore(subscribeInstallPrompt, hasCapturedInstallPrompt);
  const hasInstalled = useSyncExternalStore(subscribeInstallPrompt, hasInstalledApp);
  // Chặn bấm lặp lúc `promptInstall()` đang chờ: `hasPrompt` của lần render cũ còn true nên lần bấm hai sẽ hiện hướng dẫn nhầm.
  const isPromptingRef = useRef(false);

  if (environment.isStandalone) return null;

  const platform = detectInstallPlatform(environment);
  const buttons = resolveInstallButtons(platform);
  // Vừa cài xong (`appinstalled`) thì nút Android hết ý nghĩa; hết nút nào thì ẩn cả phần.
  const isAndroidVisible = buttons.isAndroidVisible && !hasInstalled;
  const isIosVisible = buttons.isIosVisible;
  if (!isAndroidVisible && !isIosVisible) return null;
  const isNonSafariIos = platform === 'ios' && !isIosSafari(environment);

  // Gọi prompt ngay trong handler bấm để giữ cử chỉ người dùng; không có prompt hoặc prompt lỗi thì hiện hướng dẫn dự phòng.
  const handleAndroidClick = async () => {
    if (isPromptingRef.current) return;
    if (!hasPrompt) {
      setOpenGuide('android');
      return;
    }
    isPromptingRef.current = true;
    try {
      const outcome = await promptInstall();
      if (outcome === 'unavailable') setOpenGuide('android');
    } finally {
      isPromptingRef.current = false;
    }
  };

  return (
    <section aria-label="Cài ứng dụng lên điện thoại" className="mt-6 border-t border-gray-100 pt-5 dark:border-gray-800">
      <p className="mb-3 text-center text-sm text-gray-500 dark:text-gray-400">Cài ứng dụng lên Màn hình chính</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {isAndroidVisible && (
          <button type="button" onClick={handleAndroidClick} className={`${BUTTON_OUTLINE_LG_CLASS} flex-1`}>
            <Smartphone size={18} aria-hidden="true" />
            Cài app cho Android
          </button>
        )}
        {isIosVisible && (
          <button type="button" onClick={() => setOpenGuide('ios')} className={`${BUTTON_OUTLINE_LG_CLASS} flex-1`}>
            <Smartphone size={18} aria-hidden="true" />
            Cài app cho iOS
          </button>
        )}
      </div>
      <InstallGuideDialog kind={openGuide} appUrl={resolveAppUrl()} isNonSafariIos={isNonSafariIos} onClose={() => setOpenGuide(null)} />
    </section>
  );
};

export default InstallAppButtons;
