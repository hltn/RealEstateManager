import type { NotificationPreferences } from '@crm/api/http/notificationPreferencesApi';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { BUTTON_OUTLINE_CLASS, CARD_CLASS, DIVIDER_CLASS } from '@crm/lib/uiClasses';

interface TypePreferencesSectionProps {
  preferences: NotificationPreferences | null;
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => void;
  onChange: (type: string, isPushEnabled: boolean) => void;
}

/** Lý do công tắc không bấm được (hoặc `null`): loại bị khóa bởi danh mục, hoặc đang tắt thông báo trong ứng dụng (khi đó không có push). */
const getLockReason = (canDisable: boolean, isInAppEnabled: boolean): string | null => {
  if (!canDisable) return 'Loại này luôn được gửi.';
  if (!isInAppEnabled) return 'Loại này đang tắt trong ứng dụng nên cũng không có thông báo đẩy.';
  return null;
};

/** Khối "Loại thông báo": công tắc "Thông báo đẩy" cho từng loại lấy từ `pushTypes` của máy chủ (FR-10, FR-43), không hard-code. */
export const TypePreferencesSection = ({ preferences, isLoading, loadError, onRetry, onChange }: TypePreferencesSectionProps) => (
  <section aria-labelledby="type-preferences-title" className={`${CARD_CLASS} flex flex-col gap-4 p-5`}>
    <div className="flex flex-col gap-1">
      <h3 id="type-preferences-title" className="text-base font-semibold text-gray-800 dark:text-white/90">
        Loại thông báo
      </h3>
      <p className="text-theme-sm text-gray-500 dark:text-gray-400">Chọn loại thông báo được đẩy ra thiết bị. Thông báo vẫn luôn nằm trong hộp thông báo của ứng dụng.</p>
    </div>

    {isLoading ? (
      <div aria-busy="true" aria-label="Đang tải cài đặt thông báo" className="space-y-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="h-14 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
        ))}
      </div>
    ) : loadError || !preferences ? (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-theme-sm text-error-600 dark:text-error-500">
        <span>{loadError ?? 'Không tải được cài đặt thông báo.'}</span>
        <button type="button" onClick={onRetry} className={BUTTON_OUTLINE_CLASS}>
          Thử lại
        </button>
      </div>
    ) : (
      <ul className={`divide-y ${DIVIDER_CLASS}`}>
        {preferences.pushTypes.map((info) => {
          const stored = preferences.types[info.type];
          const isInAppEnabled = stored?.inApp ?? true;
          const lockReason = getLockReason(info.canDisable, isInAppEnabled);
          const isPushOn = isInAppEnabled && (stored?.push ?? info.defaultEnabled);
          return (
            <li key={info.type} className="flex items-center gap-4 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p id={`push-type-${info.type}`} className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                  {info.label}
                </p>
                <p id={`push-type-${info.type}-desc`} className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {info.description}
                  {lockReason && ` ${lockReason}`}
                </p>
              </div>
              <ToggleSwitch
                size="sm"
                isChecked={isPushOn}
                isDisabled={lockReason !== null}
                labelledBy={`push-type-${info.type}`}
                describedBy={`push-type-${info.type}-desc`}
                onChange={(isChecked) => onChange(info.type, isChecked)}
              />
            </li>
          );
        })}
      </ul>
    )}
  </section>
);
