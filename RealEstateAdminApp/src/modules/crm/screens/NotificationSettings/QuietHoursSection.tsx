import { useState } from 'react';
import type { QuietHours } from '@crm/api/http/notificationPreferencesApi';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { BUTTON_PRIMARY_LG_CLASS, CARD_CLASS, FORM_HINT_CLASS, FORM_LABEL_CLASS, getInputClass } from '@crm/lib/uiClasses';
import { DEFAULT_QUIET_HOURS, isOvernight, isSameQuietHours, validateQuietHours } from './quietHours';

interface QuietHoursFormProps {
  /** Giá trị đang lưu ở máy chủ (`null` = tắt, mặc định). */
  saved: QuietHours | null;
  isSaving: boolean;
  onSave: (quietHours: QuietHours | null) => Promise<boolean>;
}

/**
 * Form cục bộ: công tắc + hai ô giờ, lưu bằng nút (đổi giờ từng phút không nên gửi liên tục). Remount theo `saved`
 * (qua `key` ở cha) nên lưu xong thì bản nháp khớp máy chủ; lưu lỗi thì giữ nguyên bản nháp để người dùng thử lại.
 */
const QuietHoursForm = ({ saved, isSaving, onSave }: QuietHoursFormProps) => {
  const [isEnabled, setIsEnabled] = useState(saved !== null);
  const [times, setTimes] = useState<QuietHours>(saved ?? DEFAULT_QUIET_HOURS);

  const draft = isEnabled ? times : null;
  const validationError = draft ? validateQuietHours(draft) : null;
  const isDirty = !isSameQuietHours(draft, saved);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p id="quiet-hours-switch-label" className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
            Bật giờ yên lặng
          </p>
          <p id="quiet-hours-switch-desc" className="text-theme-xs text-gray-500 dark:text-gray-400">
            Mặc định tắt. Đang tắt thì thông báo đẩy được gửi mọi lúc.
          </p>
        </div>
        <ToggleSwitch size="sm" isChecked={isEnabled} onChange={setIsEnabled} labelledBy="quiet-hours-switch-label" describedBy="quiet-hours-switch-desc" isDisabled={isSaving} />
      </div>

      {isEnabled && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="quiet-hours-start" className={FORM_LABEL_CLASS}>
                Từ giờ
              </label>
              <input
                id="quiet-hours-start"
                type="time"
                value={times.start}
                onChange={(event) => setTimes((current) => ({ ...current, start: event.target.value }))}
                aria-invalid={validationError !== null}
                aria-describedby="quiet-hours-error quiet-hours-hint"
                disabled={isSaving}
                className={getInputClass({ hasError: validationError !== null })}
              />
            </div>
            <div>
              <label htmlFor="quiet-hours-end" className={FORM_LABEL_CLASS}>
                Đến giờ
              </label>
              <input
                id="quiet-hours-end"
                type="time"
                value={times.end}
                onChange={(event) => setTimes((current) => ({ ...current, end: event.target.value }))}
                aria-invalid={validationError !== null}
                aria-describedby="quiet-hours-error quiet-hours-hint"
                disabled={isSaving}
                className={getInputClass({ hasError: validationError !== null })}
              />
            </div>
          </div>
          <p id="quiet-hours-hint" className={FORM_HINT_CLASS}>
            Theo giờ Việt Nam (UTC+7). Giờ bắt đầu tính, giờ kết thúc không tính.
            {!validationError && isOvernight(times) && ` Khung qua nửa đêm: từ ${times.start} tối đến ${times.end} sáng hôm sau.`}
          </p>
          {validationError && (
            <p id="quiet-hours-error" role="alert" className="text-theme-sm text-error-600 dark:text-error-500">
              {validationError}
            </p>
          )}
        </div>
      )}

      <p className={FORM_HINT_CLASS}>Trong giờ yên lặng sẽ không có thông báo đẩy; thông báo vẫn nằm trong hộp thông báo của ứng dụng.</p>

      <div>
        <button type="button" onClick={() => void onSave(draft)} disabled={!isDirty || validationError !== null || isSaving} className={BUTTON_PRIMARY_LG_CLASS}>
          {isSaving ? 'Đang lưu…' : 'Lưu giờ yên lặng'}
        </button>
      </div>
    </div>
  );
};

interface QuietHoursSectionProps extends QuietHoursFormProps {
  /** Chưa có dữ liệu máy chủ thì không dựng form (tránh bản nháp mặc định sai). */
  isReady: boolean;
}

/** Khối "Giờ yên lặng" (FR-10): mặc định tắt, tự chọn khung giờ, được qua nửa đêm, `start` khác `end`, ghi chú giờ Việt Nam. */
export const QuietHoursSection = ({ isReady, saved, isSaving, onSave }: QuietHoursSectionProps) => (
  <section aria-labelledby="quiet-hours-title" className={`${CARD_CLASS} flex flex-col gap-4 p-5`}>
    <h3 id="quiet-hours-title" className="text-base font-semibold text-gray-800 dark:text-white/90">
      Giờ yên lặng
    </h3>
    {isReady ? (
      <QuietHoursForm key={saved ? `${saved.start}-${saved.end}` : 'off'} saved={saved} isSaving={isSaving} onSave={onSave} />
    ) : (
      <div aria-busy="true" aria-label="Đang tải giờ yên lặng" className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
    )}
  </section>
);
