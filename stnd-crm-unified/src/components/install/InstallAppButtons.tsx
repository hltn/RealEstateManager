import { useState, type ReactNode } from 'react';
import { Smartphone } from 'lucide-react';
import { DialogFrame } from '@crm/components/DialogFrame';
import { BUTTON_OUTLINE_LG_CLASS, BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';
import { detectInstallPlatform, isIosSafari, readInstallEnvironment, resolveInstallButtons } from './installPlatform';

type GuideKind = 'ios' | 'android';

/** Địa chỉ web hiển thị trong hướng dẫn: origin của trang đang mở (giống Admin App). */
const resolveAppUrl = (): string => window.location.origin;

const GUIDE_TITLES: Record<GuideKind, string> = {
  ios: 'Cài ứng dụng trên iPhone/iPad',
  android: 'Cài ứng dụng trên Android',
};

/** Câu hướng dẫn cài lên Màn hình chính (giống `IosInstallGuideText` của Admin App). */
const IosInstallGuideText = () => (
  <>
    Cài STND lên Màn hình chính: bấm nút <strong>Chia sẻ</strong> của Safari, rồi chọn <strong>Thêm vào MH chính</strong>.
  </>
);

interface InstallGuideDialogProps {
  kind: GuideKind | null;
  appUrl: string;
  /** iPhone/iPad nhưng KHÔNG phải Safari (Chrome, Zalo...): "Thêm vào MH chính" chỉ chắc chắn có ở Safari. */
  isNonSafariIos: boolean;
  onClose: () => void;
}

/** Hộp thoại hướng dẫn cài tay: iOS (Chia sẻ, Thêm vào MH chính) và Android (menu trình duyệt). */
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
 * Hai nút đưa web ra Màn hình chính điện thoại, đặt dưới form đăng nhập (FR-27, đồng bộ giao diện từ Admin App).
 * - Android chỉ thấy nút Android, iOS/iPadOS chỉ thấy nút iOS, máy tính/không nhận ra thấy cả hai.
 * - Ẩn hẳn khi đang chạy standalone.
 * - Prototype không có manifest/service worker: nút Android luôn mở hướng dẫn dự phòng (menu trình duyệt), không có prompt cài tự động.
 * - Nút iOS mở hộp thoại hướng dẫn (iOS không cho web tự cài).
 */
const InstallAppButtons = () => {
  // Môi trường không đổi trong phiên nên đọc một lần.
  const [environment] = useState(readInstallEnvironment);
  const [openGuide, setOpenGuide] = useState<GuideKind | null>(null);

  if (environment.isStandalone) return null;

  const platform = detectInstallPlatform(environment);
  const { isAndroidVisible, isIosVisible } = resolveInstallButtons(platform);
  const isNonSafariIos = platform === 'ios' && !isIosSafari(environment);

  return (
    <section aria-label="Cài ứng dụng lên điện thoại" className="mt-6 border-t border-gray-100 pt-5 dark:border-gray-800">
      <p className="mb-3 text-center text-sm text-gray-500 dark:text-gray-400">Cài ứng dụng lên Màn hình chính</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {isAndroidVisible && (
          <button type="button" onClick={() => setOpenGuide('android')} className={`${BUTTON_OUTLINE_LG_CLASS} flex-1`}>
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
