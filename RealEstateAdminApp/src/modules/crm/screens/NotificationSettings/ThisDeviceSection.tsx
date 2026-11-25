import { BellOff, BellRing } from 'lucide-react';
import type { ReactNode } from 'react';
import { BUTTON_OUTLINE_LG_CLASS, BUTTON_PRIMARY_LG_CLASS, CARD_CLASS, INSET_CLASS } from '@crm/lib/uiClasses';
import type { UsePushSubscriptionResult } from '@crm/hooks/usePushSubscription';
import { IosInstallGuideText } from '../../../../pwa/IosInstallHint';

interface ThisDeviceSectionProps {
  push: UsePushSubscriptionResult;
  onEnable: () => void;
  onDisable: () => void;
}

const Note = ({ children }: { children: ReactNode }) => (
  <p className={`${INSET_CLASS} px-4 py-3 text-theme-sm text-gray-600 dark:text-gray-400`}>{children}</p>
);

/**
 * Nội dung khối theo trạng thái của thiết bị (FR-09). Thứ tự: đang bật (luôn cho Tắt) -> máy chủ chưa bật push
 * -> iPhone chưa cài (không có nút, chỉ hướng dẫn) -> quyền bị chặn -> sẵn sàng (nút Bật) -> không hỗ trợ.
 */
const renderBody = ({ push, onEnable, onDisable }: ThisDeviceSectionProps): ReactNode => {
  if (push.canDisable) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-theme-sm text-gray-600 dark:text-gray-400">Thiết bị này đang nhận thông báo đẩy.</p>
        <div>
          <button type="button" onClick={onDisable} disabled={push.isBusy} className={BUTTON_OUTLINE_LG_CLASS}>
            <BellOff size={18} aria-hidden="true" />
            {push.isBusy ? 'Đang tắt…' : 'Tắt thông báo'}
          </button>
        </div>
      </div>
    );
  }
  if (!push.isAvailable) return <Note>Thông báo đẩy chưa được bật trên hệ thống. Bạn vẫn xem được thông báo trong ứng dụng.</Note>;
  switch (push.state) {
    case 'needs-install':
      return (
        <Note>
          <IosInstallGuideText /> Sau đó mở STND từ biểu tượng trên Màn hình chính và quay lại trang này để bật thông báo.
        </Note>
      );
    case 'blocked':
      return <Note>Bạn đã chặn thông báo cho STND. Hãy mở lại quyền Thông báo trong cài đặt của trình duyệt hoặc ứng dụng, rồi tải lại trang này.</Note>;
    case 'ready':
      return (
        <div className="flex flex-col gap-3">
          <p className="text-theme-sm text-gray-600 dark:text-gray-400">Nhận nhắc việc, lịch hẹn và phân khách ngay cả khi không mở ứng dụng.</p>
          <div>
            <button type="button" onClick={onEnable} disabled={push.isBusy} className={BUTTON_PRIMARY_LG_CLASS}>
              <BellRing size={18} aria-hidden="true" />
              {push.isBusy ? 'Đang bật…' : 'Bật thông báo'}
            </button>
          </div>
        </div>
      );
    default:
      return <Note>Trình duyệt này chưa hỗ trợ thông báo đẩy. Hãy dùng Chrome (Android) hoặc Safari đã cài ứng dụng (iPhone).</Note>;
  }
};

/** Khối "Thiết bị này": trạng thái + nút Bật/Tắt thông báo đẩy của chính trình duyệt đang mở (FR-09, FR-01). */
export const ThisDeviceSection = (props: ThisDeviceSectionProps) => {
  const { push } = props;
  return (
    <section aria-labelledby="this-device-title" className={`${CARD_CLASS} flex flex-col gap-4 p-5`}>
      <h3 id="this-device-title" className="text-base font-semibold text-gray-800 dark:text-white/90">
        Thiết bị này
      </h3>
      {push.isLoading ? <div aria-busy="true" aria-label="Đang kiểm tra thiết bị" className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" /> : renderBody(props)}
      {push.error && (
        <p role="alert" className="text-theme-sm text-error-600 dark:text-error-500">
          {push.error}
        </p>
      )}
    </section>
  );
};
