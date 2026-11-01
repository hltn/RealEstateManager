/**
 * Cài đặt nhắc việc (`GET/PATCH /crm/settings`, 05 §2.14): ngưỡng khách lâu chưa chăm sóc, giờ quét/gửi nhắc, mốc nhắc dịp đặc biệt
 * và lịch hẹn, thời hạn sửa nhật ký, ngưỡng cảnh báo xem SĐT. Chỉ Quản trị sửa; chỉ gửi trường đã đổi.
 */
import { useState, type FormEvent } from 'react';
import { useCatalogs, useCrmApi } from '@crm/api';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { TextInput } from '@crm/components/form/TextInput';
import { BUTTON_PRIMARY_CLASS, CARD_CLASS, MUTED_TEXT_CLASS } from '@crm/lib/uiClasses';
import { useCrmActions } from '@crm/store';
import type { CrmSettings } from '@crm/types/crm';
import { diffSettings, parseSettingsDraft, SETTINGS_FIELD_META, toSettingsDraft, type SettingsDraft } from '../settingsForms';

interface ReminderFormProps {
  settings: CrmSettings;
}

const ReminderForm = ({ settings }: ReminderFormProps) => {
  const api = useCrmApi();
  const { showToast } = useCrmActions();
  const [draft, setDraft] = useState<SettingsDraft>(() => toSettingsDraft(settings));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const parsed = parseSettingsDraft(draft);
    if ('error' in parsed) {
      setError(parsed.error);
      return;
    }
    const changes = diffSettings(settings, parsed.value);
    if (Object.keys(changes).length === 0) {
      showToast({ type: 'info', title: 'Chưa có thay đổi nào để lưu' });
      return;
    }
    setIsSaving(true);
    const result = await api.updateSettings(changes);
    setIsSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    showToast({ title: 'Đã lưu cài đặt nhắc việc', message: 'Bộ nhắc việc đọc lại cấu hình ở lần chạy kế tiếp.' });
  };

  return (
    <form onSubmit={handleSubmit} className={`${CARD_CLASS} space-y-4 p-4 sm:p-5`} aria-label="Cài đặt nhắc việc">
      <p className={`${MUTED_TEXT_CLASS} max-w-2xl`}>Áp dụng cho nhắc việc và mục "Việc hôm nay" của mọi người dùng.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SETTINGS_FIELD_META.map((meta) => {
          const id = `settings-${meta.key}`;
          return (
            <FormField key={meta.key} inputId={id} label={meta.label} hint={meta.hint}>
              <TextInput
                id={id}
                type={meta.kind === 'number' ? 'number' : 'text'}
                inputMode={meta.kind === 'time' ? 'numeric' : undefined}
                value={draft[meta.key]}
                onChange={(event) => {
                  setDraft({ ...draft, [meta.key]: event.target.value });
                  setError(null);
                }}
              />
            </FormField>
          );
        })}
      </div>
      <FieldError id="settings-reminders-error" message={error ?? undefined} />
      <div className="flex justify-end">
        <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY_CLASS}>
          {isSaving ? 'Đang lưu…' : 'Lưu cài đặt'}
        </button>
      </div>
    </form>
  );
};

export const ReminderSettingsSection = () => {
  const { settings } = useCatalogs();
  if (!settings) return <div aria-busy="true" aria-label="Đang tải cài đặt" className="h-40 animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800" />;
  // `key` theo nội dung: cấu hình đổi từ nơi khác thì dựng lại form từ bản mới.
  return <ReminderForm key={JSON.stringify(settings)} settings={settings} />;
};
