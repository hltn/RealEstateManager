import { BellRing } from 'lucide-react';
import { DialogFrame } from '@crm/components/DialogFrame';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS } from '@crm/lib/uiClasses';
import { usePushOptIn } from './usePushOptIn';

const BODY_CLASS = 'space-y-3 text-theme-sm leading-relaxed text-gray-600 dark:text-gray-400';

/**
 * Hộp thoại mời bật thông báo đẩy khi mở app dạng PWA (FR-28), gắn ở shell sau xác thực.
 * Điều kiện hiện và việc "chỉ hỏi một lần" nằm ở `usePushOptIn`; quyền của trình duyệt chỉ được xin khi bấm "Bật".
 * Esc tính là "Để sau"; nhấp nền KHÔNG đóng ở bước mời (tránh lỡ tay bỏ qua vĩnh viễn). Quyền bị từ chối thì chuyển sang hướng dẫn mở lại quyền (không hỏi lại).
 */
const PushOptInDialog = () => {
  const { isOpen, phase, isBusy, error, enable, skip, close } = usePushOptIn();

  if (phase === 'denied') {
    return (
      <DialogFrame isOpen={isOpen} title="Thông báo đang bị chặn" describedById="push-opt-in-description" onClose={close}>
        <div id="push-opt-in-description" className={BODY_CLASS}>
          <p>Trình duyệt đã không cấp quyền thông báo cho STND nên ứng dụng chưa thể gửi thông báo.</p>
          <p>
            Để bật lại, hãy mở quyền <strong>Thông báo</strong> của STND trong cài đặt của trình duyệt hoặc ứng dụng trên điện thoại, rồi vào{' '}
            <strong>Cài đặt thông báo</strong> trong ứng dụng để bật.
          </p>
        </div>
        <div className="flex justify-end pt-2">
          <button type="button" data-autofocus onClick={close} className={BUTTON_PRIMARY_CLASS}>
            Đã hiểu
          </button>
        </div>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame isOpen={isOpen} title="Bật thông báo cho STND?" isBackdropClosable={false} describedById="push-opt-in-description" onClose={close}>
      <div id="push-opt-in-description" className={BODY_CLASS}>
        <p>Nhận nhắc việc, lịch hẹn và phân khách ngay cả khi không mở ứng dụng.</p>
        <p>Bạn có thể đổi lại bất cứ lúc nào ở Cài đặt thông báo.</p>
        {error && (
          <p role="alert" className="text-error-600 dark:text-error-500">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={skip} disabled={isBusy} className={BUTTON_OUTLINE_CLASS}>
          Để sau
        </button>
        <button type="button" data-autofocus onClick={enable} disabled={isBusy} className={BUTTON_PRIMARY_CLASS}>
          <BellRing size={16} aria-hidden="true" />
          {isBusy ? 'Đang bật…' : 'Bật thông báo'}
        </button>
      </div>
    </DialogFrame>
  );
};

export default PushOptInDialog;
