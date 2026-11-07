/**
 * Form sửa 1 trường chân dung (FR-41): nhãn, và với SELECT/MULTI_SELECT là danh sách lựa chọn. Lựa chọn đã có chỉ TẮT được (không xóa;
 * khách đã chọn vẫn giữ và hiển thị đúng), lựa chọn mới thêm trong form thì bỏ đi được. Không đổi kiểu/khóa trường (đợt 2).
 */
import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, BUTTON_SOFT_SM_CLASS, CARD_TITLE_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, FORM_HINT_CLASS, INSET_CLASS } from '@crm/lib/uiClasses';
import type { AdminPersonaField } from '@crm/types/crm';
import { PERSONA_LABEL_MAX_LENGTH, addOptionToDraft, hasPersonaOptions, type PersonaFieldDraft } from '../personaFieldForms';

interface PersonaFieldEditorProps {
  field: AdminPersonaField;
  draft: PersonaFieldDraft;
  error: string | null;
  isSaving: boolean;
  onChange: (draft: PersonaFieldDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}

const fieldId = (name: string) => `settings-persona-${name}`;

export const PersonaFieldEditor = ({ field, draft, error, isSaving, onChange, onSave, onCancel }: PersonaFieldEditorProps) => {
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [optionError, setOptionError] = useState<string | null>(null);
  const hasOptions = hasPersonaOptions(field.type);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };

  const updateOption = (index: number, changes: Partial<PersonaFieldDraft['options'][number]>) =>
    onChange({ ...draft, options: draft.options.map((option, position) => (position === index ? { ...option, ...changes } : option)) });

  const addOption = () => {
    const result = addOptionToDraft(draft, newOptionLabel);
    setOptionError(result.error);
    if (result.error) return;
    onChange(result.draft);
    setNewOptionLabel('');
  };

  // Enter ở ô "thêm lựa chọn" thêm lựa chọn chứ không gửi cả form.
  const handleNewOptionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addOption();
  };

  return (
    <form noValidate onSubmit={handleSubmit} className={`${INSET_CLASS} space-y-4 p-4`} aria-label={`Sửa trường ${field.label}`}>
      <h3 className={CARD_TITLE_CLASS}>Sửa trường "{field.label}"</h3>
      <FormField inputId={fieldId('label')} label="Nhãn trường" isRequired hint={`Mã trường "${field.key}" không đổi được.`}>
        <TextInput id={fieldId('label')} value={draft.label} maxLength={PERSONA_LABEL_MAX_LENGTH} autoFocus onChange={(event) => onChange({ ...draft, label: event.target.value })} />
      </FormField>

      {hasOptions && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Lựa chọn</legend>
          <p className={FORM_HINT_CLASS}>Tắt một lựa chọn = ẩn khỏi lựa chọn mới; khách đã chọn vẫn giữ và hiển thị đúng. Đổi tên không làm mất dữ liệu cũ.</p>
          <ul className="space-y-2">
            {draft.options.map((option, index) => (
              <li key={option.value} className="flex items-center gap-2">
                <TextInput
                  aria-label={`Tên lựa chọn ${index + 1}`}
                  value={option.label}
                  maxLength={PERSONA_LABEL_MAX_LENGTH}
                  // Lựa chọn đã tắt không gửi lên nên không đổi tên được; bật lại rồi mới sửa.
                  disabled={!option.isActive}
                  onChange={(event) => updateOption(index, { label: event.target.value })}
                />
                {!option.isActive && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray} shrink-0`}>Đã tắt</span>}
                {option.isNew ? (
                  <button type="button" className={BUTTON_SOFT_SM_CLASS} aria-label={`Bỏ lựa chọn ${option.label}`} onClick={() => onChange({ ...draft, options: draft.options.filter((_, position) => position !== index) })}>
                    <X size={12} aria-hidden="true" />
                    Bỏ
                  </button>
                ) : (
                  <ToggleSwitch isChecked={option.isActive} onChange={(isActive) => updateOption(index, { isActive })} label={`Đang dùng lựa chọn ${option.label}`} size="sm" />
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <TextInput
                aria-label="Thêm lựa chọn mới"
                placeholder="Tên lựa chọn mới"
                value={newOptionLabel}
                maxLength={PERSONA_LABEL_MAX_LENGTH}
                onChange={(event) => {
                  setNewOptionLabel(event.target.value);
                  setOptionError(null);
                }}
                onKeyDown={handleNewOptionKeyDown}
              />
              <FieldError id={fieldId('option-error')} message={optionError ?? undefined} />
            </div>
            <button type="button" onClick={addOption} className={BUTTON_SOFT_SM_CLASS}>
              <Plus size={12} aria-hidden="true" />
              Thêm lựa chọn
            </button>
          </div>
        </fieldset>
      )}

      <FieldError id={fieldId('error')} message={error ?? undefined} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={BUTTON_OUTLINE_CLASS}>
          Huỷ
        </button>
        <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY_CLASS}>
          {isSaving ? 'Đang lưu…' : 'Lưu'}
        </button>
      </div>
    </form>
  );
};
