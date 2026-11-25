/**
 * Danh sách lựa chọn của trường SELECT/MULTI_SELECT (FR-41), dùng chung cho form sửa và form thêm trường. Lựa chọn đã có chỉ TẮT được
 * (không xóa; khách đã chọn vẫn giữ và hiển thị đúng), lựa chọn mới thêm trong form thì bỏ đi được.
 */
import { useState, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { FieldError } from '@crm/components/form/FieldError';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { BUTTON_SOFT_SM_CLASS, CHIP_SMALL_CLASS, CHIP_TONE_CLASS, FORM_HINT_CLASS } from '@crm/lib/uiClasses';
import { PERSONA_LABEL_MAX_LENGTH, addOptionToDraft, type OptionDraft } from '../personaFieldForms';

interface PersonaOptionsEditorProps {
  options: OptionDraft[];
  onChange: (options: OptionDraft[]) => void;
  /** Tiền tố id cho dòng lỗi (`${idPrefix}-option-error`). */
  idPrefix: string;
  hint?: string;
}

export const PersonaOptionsEditor = ({ options, onChange, idPrefix, hint }: PersonaOptionsEditorProps) => {
  const [newOptionLabel, setNewOptionLabel] = useState('');
  const [optionError, setOptionError] = useState<string | null>(null);

  const updateOption = (index: number, changes: Partial<OptionDraft>) => onChange(options.map((option, position) => (position === index ? { ...option, ...changes } : option)));

  const addOption = () => {
    const result = addOptionToDraft({ options }, newOptionLabel);
    setOptionError(result.error);
    if (result.error) return;
    onChange(result.draft.options);
    setNewOptionLabel('');
  };

  // Enter ở ô "thêm lựa chọn" thêm lựa chọn chứ không gửi cả form.
  const handleNewOptionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addOption();
  };

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-gray-700 dark:text-gray-300">Lựa chọn</legend>
      {hint && <p className={FORM_HINT_CLASS}>{hint}</p>}
      <ul className="space-y-2">
        {options.map((option, index) => (
          <li key={option.value} className="flex items-center gap-2">
            <TextInput
              aria-label={`Tên lựa chọn ${index + 1}`}
              value={option.label}
              maxLength={PERSONA_LABEL_MAX_LENGTH}
              // Lựa chọn đã tắt không gửi lên nên không đổi tên được; bật lại rồi mới sửa.
              disabled={!option.isActive}
              wrapperClassName="min-w-0 flex-1"
              onChange={(event) => updateOption(index, { label: event.target.value })}
            />
            {!option.isActive && <span className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.gray} shrink-0`}>Đã tắt</span>}
            {option.isNew ? (
              <button type="button" className={`${BUTTON_SOFT_SM_CLASS} shrink-0`} aria-label={`Bỏ lựa chọn ${option.label}`} onClick={() => onChange(options.filter((_, position) => position !== index))}>
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
          <FieldError id={`${idPrefix}-option-error`} message={optionError ?? undefined} />
        </div>
        <button type="button" onClick={addOption} className={`${BUTTON_SOFT_SM_CLASS} shrink-0`}>
          <Plus size={12} aria-hidden="true" />
          Thêm lựa chọn
        </button>
      </div>
    </fieldset>
  );
};
