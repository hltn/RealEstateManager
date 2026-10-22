/**
 * Cài đặt nhắc việc (C13 + Việc hôm nay): nhắc dịp đặc biệt trước N ngày, khách lâu chưa chăm sóc, cửa sổ "Sắp tới".
 */
import { useState, type FormEvent } from 'react';
import { SETTINGS_LIMITS, useCatalogs, useCrmApi } from '@crm/api';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { TextInput } from '@crm/components/form/TextInput';
import { BUTTON_PRIMARY_CLASS, CARD_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { CrmSettings } from '@crm/types/crm';

const FIELD_ORDER: (keyof CrmSettings)[] = ['occasionLeadDays', 'staleCustomerDays', 'upcomingDays'];

export const ReminderSettingsSection = () => {
  const { settings } = useCatalogs();
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [draft, setDraft] = useState<Record<keyof CrmSettings, string>>(() => ({
    occasionLeadDays: String(settings.occasionLeadDays),
    staleCustomerDays: String(settings.staleCustomerDays),
    upcomingDays: String(settings.upcomingDays),
  }));
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const changes = Object.fromEntries(FIELD_ORDER.map((key) => [key, Number(draft[key])])) as unknown as CrmSettings;
    const result = api.updateSettings(changes);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    showToast({ title: 'Đã lưu cài đặt nhắc việc' });
  };

  return (
    <form onSubmit={handleSubmit} className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`} aria-label="Cài đặt nhắc việc">
      <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>
        Áp dụng cho mục "Việc hôm nay" của mọi người dùng. Nhắc dịp đặc biệt chỉ chạy với khách đang bật "Nhắc dịp đặc biệt".
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FIELD_ORDER.map((key) => {
          const limit = SETTINGS_LIMITS[key];
          const id = `settings-${key}`;
          return (
            <FormField key={key} inputId={id} label={limit.label} hint={`${limit.min}–${limit.max} ngày`}>
              <TextInput
                id={id}
                type="number"
                min={limit.min}
                max={limit.max}
                value={draft[key]}
                rightAddon="ngày"
                onChange={(event) => {
                  setDraft({ ...draft, [key]: event.target.value });
                  setError(null);
                }}
              />
            </FormField>
          );
        })}
      </div>
      <FieldError id="settings-reminders-error" message={error ?? undefined} />
      <div className="flex justify-end">
        <button type="submit" className={BUTTON_PRIMARY_CLASS}>
          Lưu cài đặt
        </button>
      </div>
    </form>
  );
};
