import { Smartphone } from 'lucide-react';
import type { PushDevice } from '@crm/api/http/pushApi';
import { formatVnRelative } from '@crm/lib/dateTime';
import { BUTTON_OUTLINE_CLASS, CARD_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, DIVIDER_CLASS } from '@crm/lib/uiClasses';
import { MAX_PUSH_DEVICES } from './useNotificationSettings';

interface DeviceListSectionProps {
  devices: PushDevice[];
  currentDeviceId: string | null;
  displacedNotices: string[];
  isLoading: boolean;
  loadError: string | null;
  actionMessage: string | null;
  removingDeviceId: string | null;
  onRetry: () => void;
  onRemove: (deviceId: string) => void;
}

/** Danh sách thiết bị đang nhận thông báo của chính người dùng (tối đa 3), thông báo thiết bị bị gỡ để nhường chỗ, nút gỡ (FR-01, FR-09). */
export const DeviceListSection = ({ devices, currentDeviceId, displacedNotices, isLoading, loadError, actionMessage, removingDeviceId, onRetry, onRemove }: DeviceListSectionProps) => (
  <section aria-labelledby="device-list-title" className={`${CARD_CLASS} flex flex-col gap-4 p-5`}>
    <div className="flex flex-col gap-1">
      <h3 id="device-list-title" className="text-base font-semibold text-gray-800 dark:text-white/90">
        Thiết bị của bạn
      </h3>
      <p className="text-theme-sm text-gray-500 dark:text-gray-400">
        Tối đa {MAX_PUSH_DEVICES} thiết bị cùng nhận thông báo; bật thêm thiết bị thứ {MAX_PUSH_DEVICES + 1} thì thiết bị ít dùng nhất sẽ bị gỡ.
      </p>
    </div>

    {displacedNotices.length > 0 && (
      <ul role="status" className="flex flex-col gap-1 rounded-xl bg-warning-50 px-4 py-3 text-theme-sm text-warning-700 dark:bg-warning-500/10 dark:text-warning-500">
        {displacedNotices.map((notice, index) => (
          <li key={`${index}-${notice}`}>{notice}</li>
        ))}
      </ul>
    )}

    {actionMessage && (
      <p role="alert" className="text-theme-sm text-error-600 dark:text-error-500">
        {actionMessage}
      </p>
    )}

    {isLoading ? (
      <div aria-busy="true" aria-label="Đang tải danh sách thiết bị" className="space-y-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
    ) : loadError ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-theme-sm text-error-600 dark:text-error-500">
        <span>{loadError}</span>
        <button type="button" onClick={onRetry} className={BUTTON_OUTLINE_CLASS}>
          Thử lại
        </button>
      </div>
    ) : devices.length === 0 ? (
      <p className="text-theme-sm text-gray-500 dark:text-gray-400">Chưa có thiết bị nào bật thông báo.</p>
    ) : (
      <ul className={`divide-y ${DIVIDER_CLASS}`}>
        {devices.map((device) => (
          <li key={device.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Smartphone size={20} className="shrink-0 text-gray-400" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-theme-sm font-medium text-gray-800 dark:text-white/90">
                <span className="truncate">{device.deviceLabel}</span>
                {device.id === currentDeviceId && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.brand}`}>Thiết bị này</span>}
              </p>
              <p className="text-theme-xs text-gray-500 dark:text-gray-400">Dùng gần nhất: {formatVnRelative(device.lastSeenAt)}</p>
            </div>
            <button type="button" aria-label={`Gỡ thiết bị ${device.deviceLabel}`} onClick={() => onRemove(device.id)} disabled={removingDeviceId !== null} className={BUTTON_OUTLINE_CLASS}>
              {removingDeviceId === device.id ? 'Đang gỡ…' : 'Gỡ'}
            </button>
          </li>
        ))}
      </ul>
    )}
  </section>
);
