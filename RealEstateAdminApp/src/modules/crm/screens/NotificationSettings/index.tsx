import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PAGE_DESCRIPTION_CLASS, PAGE_TITLE_CLASS } from '@crm/lib/uiClasses';
import { DeviceListSection } from './DeviceListSection';
import { ThisDeviceSection } from './ThisDeviceSection';
import { useNotificationSettings } from './useNotificationSettings';

/**
 * Trang "Cài đặt thông báo" cá nhân (`/notification-settings`, T-41, FR-09, FR-01): bật/tắt thông báo đẩy của thiết bị này
 * và quản lý các thiết bị đã bật. Công tắc theo loại và giờ yên lặng thuộc T-42 (thêm sau, cùng trang).
 * Nằm ngoài `/crm` (không có CrmProvider) giống màn Thông báo.
 */
export const NotificationSettingsScreen = () => {
  const settings = useNotificationSettings();

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link to="/notifications" className="inline-flex min-h-11 items-center gap-1.5 self-start text-theme-sm font-medium text-brand-600 hover:underline dark:text-brand-400">
          <ArrowLeft size={16} aria-hidden="true" />
          Quay lại Thông báo
        </Link>
        <h2 className={PAGE_TITLE_CLASS}>Cài đặt thông báo</h2>
        <p className={PAGE_DESCRIPTION_CLASS}>Chọn thiết bị nhận thông báo đẩy từ STND.</p>
      </header>

      <ThisDeviceSection push={settings.push} onEnable={() => void settings.enableThisDevice()} onDisable={() => void settings.disableThisDevice()} />
      <DeviceListSection
        devices={settings.devices}
        currentDeviceId={settings.currentDeviceId}
        displacedNotices={settings.displacedNotices}
        isLoading={settings.isDevicesLoading}
        loadError={settings.devicesError}
        actionMessage={settings.actionMessage}
        removingDeviceId={settings.removingDeviceId}
        onRetry={settings.retryDevices}
        onRemove={(deviceId) => void settings.removeDevice(deviceId)}
      />
    </div>
  );
};

export default NotificationSettingsScreen;
