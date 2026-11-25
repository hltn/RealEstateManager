/**
 * Form THÊM trường chân dung (FR-41, đợt 2): nhãn, mã (key, bất biến sau khi tạo), nhóm, kiểu, lựa chọn (SELECT/MULTI_SELECT),
 * trọng số, "Lọc được" và "Nhạy cảm". Quy tắc FE khóa sớm giống backend: nhạy cảm và lọc được loại trừ nhau, lọc được chỉ với
 * TEXT/SELECT/MULTI_SELECT/BOOLEAN. Trường vừa tạo dùng được ngay ở form chân dung (danh mục được làm mới sau khi lưu).
 */
import type { FormEvent } from 'react';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { PERSONA_GROUP_LABELS } from '@crm/data/personaFields';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, CARD_TITLE_CLASS, INSET_CLASS } from '@crm/lib/uiClasses';
import type { PersonaFieldType } from '@crm/types/crm';
import {
  PERSONA_CREATABLE_TYPES,
  PERSONA_FIELD_TYPE_LABELS,
  PERSONA_KEY_MAX_LENGTH,
  PERSONA_LABEL_MAX_LENGTH,
  PERSONA_MAX_WEIGHT,
  changeCreateDraftType,
  hasPersonaOptions,
  isAdvancedFilterType,
  isFilterableType,
  suggestPersonaFieldKey,
  type PersonaFieldCreateDraft,
} from '../personaFieldForms';
import { PersonaOptionsEditor } from './PersonaOptionsEditor';

interface PersonaFieldCreateFormProps {
  draft: PersonaFieldCreateDraft;
  error: string | null;
  isSaving: boolean;
  onChange: (draft: PersonaFieldCreateDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}

const fieldId = (name: string) => `settings-persona-new-${name}`;
const GROUP_OPTIONS = Object.entries(PERSONA_GROUP_LABELS).map(([value, label]) => ({ value, label }));
const TYPE_OPTIONS = PERSONA_CREATABLE_TYPES.map((value) => ({ value, label: PERSONA_FIELD_TYPE_LABELS[value] }));

/** Gợi ý dưới "Lọc được": kiểu hiện ở bộ lọc nâng cao thì nói rõ; kiểu khác chỉ lọc qua API (TEXT, v.v.). */
const getFilterableHint = (type: PersonaFieldType, isSensitive: boolean): string => {
  if (isSensitive) return 'Trường nhạy cảm không dùng để lọc.';
  if (!isFilterableType(type)) return 'Kiểu này không lọc được.';
  return isAdvancedFilterType(type) ? 'Hiện ở bộ lọc nâng cao của danh sách khách.' : 'Cho phép lọc qua API; chưa hiện ở bộ lọc nâng cao.';
};

export const PersonaFieldCreateForm = ({ draft, error, isSaving, onChange, onSave, onCancel }: PersonaFieldCreateFormProps) => {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };

  // Mã tự sinh theo nhãn cho tới khi người dùng tự sửa mã.
  const handleLabelChange = (label: string) => onChange({ ...draft, label, key: draft.isKeyEdited ? draft.key : suggestPersonaFieldKey(label) });
  const canFilter = isFilterableType(draft.type) && !draft.isSensitive;
  const filterableHint = getFilterableHint(draft.type, draft.isSensitive);

  return (
    <form noValidate onSubmit={handleSubmit} className={`${INSET_CLASS} space-y-4 p-4`} aria-label="Thêm trường chân dung" data-testid="persona-field-create-form">
      <h3 className={CARD_TITLE_CLASS}>Thêm trường chân dung</h3>

      <FormField inputId={fieldId('label')} label="Nhãn trường" isRequired>
        <TextInput id={fieldId('label')} value={draft.label} maxLength={PERSONA_LABEL_MAX_LENGTH} autoFocus onChange={(event) => handleLabelChange(event.target.value)} />
      </FormField>

      <FormField inputId={fieldId('key')} label="Mã trường" isRequired hint="Chữ thường, số, dấu gạch dưới; không đổi được sau khi tạo.">
        <TextInput id={fieldId('key')} value={draft.key} maxLength={PERSONA_KEY_MAX_LENGTH} onChange={(event) => onChange({ ...draft, key: event.target.value, isKeyEdited: true })} />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField inputId={fieldId('group')} label="Nhóm" isRequired>
          <SelectInput id={fieldId('group')} value={draft.groupCode} options={GROUP_OPTIONS} onChange={(event) => onChange({ ...draft, groupCode: event.target.value })} />
        </FormField>
        <FormField inputId={fieldId('type')} label="Kiểu" isRequired hint="Không đổi kiểu được khi đã có dữ liệu khách.">
          <SelectInput id={fieldId('type')} value={draft.type} options={TYPE_OPTIONS} onChange={(event) => onChange(changeCreateDraftType(draft, event.target.value as PersonaFieldType))} />
        </FormField>
      </div>

      {hasPersonaOptions(draft.type) && (
        <PersonaOptionsEditor options={draft.options} onChange={(options) => onChange({ ...draft, options })} idPrefix="settings-persona-new" />
      )}

      <FormField inputId={fieldId('weight')} label="Trọng số" isRequired hint={`Số nguyên 0 đến ${PERSONA_MAX_WEIGHT}; càng cao càng tính nhiều vào độ đầy đủ chân dung.`}>
        <TextInput id={fieldId('weight')} type="number" inputMode="numeric" min={0} max={PERSONA_MAX_WEIGHT} step={1} value={draft.weight} onChange={(event) => onChange({ ...draft, weight: event.target.value })} />
      </FormField>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id={fieldId('filterable-label')} className="text-sm font-medium text-gray-700 dark:text-gray-300">Lọc được</p>
            <p id={fieldId('filterable-hint')} className="text-theme-xs text-gray-500 dark:text-gray-400">
              {filterableHint}
            </p>
          </div>
          <ToggleSwitch
            isChecked={draft.isFilterable && canFilter}
            onChange={(isFilterable) => onChange({ ...draft, isFilterable })}
            labelledBy={fieldId('filterable-label')}
            describedBy={fieldId('filterable-hint')}
            size="sm"
            isDisabled={!canFilter}
          />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id={fieldId('sensitive-label')} className="text-sm font-medium text-gray-700 dark:text-gray-300">Nhạy cảm</p>
            <p id={fieldId('sensitive-hint')} className="text-theme-xs text-gray-500 dark:text-gray-400">
              Chỉ lưu khi khách tự chia sẻ và nhân viên xác nhận; nhật ký không ghi nội dung. Không đi cùng "Lọc được".
            </p>
          </div>
          <ToggleSwitch
            isChecked={draft.isSensitive}
            onChange={(isSensitive) => onChange({ ...draft, isSensitive, isFilterable: isSensitive ? false : draft.isFilterable })}
            labelledBy={fieldId('sensitive-label')}
            describedBy={fieldId('sensitive-hint')}
            size="sm"
          />
        </div>
      </div>

      <FieldError id={fieldId('error')} message={error ?? undefined} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={BUTTON_OUTLINE_CLASS}>
          Huỷ
        </button>
        <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY_CLASS}>
          {isSaving ? 'Đang lưu…' : 'Thêm trường'}
        </button>
      </div>
    </form>
  );
};
