/**
 * Form sửa 1 trường chân dung (FR-41): nhãn, và với SELECT/MULTI_SELECT là danh sách lựa chọn. Lựa chọn đã có chỉ TẮT được (không xóa;
 * khách đã chọn vẫn giữ và hiển thị đúng), lựa chọn mới thêm trong form thì bỏ đi được. Không đổi kiểu/mã trường (đổi kiểu bị
 * backend chặn khi đã có dữ liệu hoặc là trường hệ thống; muốn kiểu khác thì thêm trường mới).
 */
import type { FormEvent } from 'react';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { TextInput } from '@crm/components/form/TextInput';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, CARD_TITLE_CLASS, INSET_CLASS } from '@crm/lib/uiClasses';
import type { AdminPersonaField } from '@crm/types/crm';
import { PERSONA_LABEL_MAX_LENGTH, hasPersonaOptions, type PersonaFieldDraft } from '../personaFieldForms';
import { PersonaOptionsEditor } from './PersonaOptionsEditor';

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
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };

  return (
    <form noValidate onSubmit={handleSubmit} className={`${INSET_CLASS} space-y-4 p-4`} aria-label={`Sửa trường ${field.label}`}>
      <h3 className={CARD_TITLE_CLASS}>Sửa trường "{field.label}"</h3>
      <FormField inputId={fieldId('label')} label="Nhãn trường" isRequired hint={`Mã trường "${field.key}" và kiểu không đổi được.`}>
        <TextInput id={fieldId('label')} value={draft.label} maxLength={PERSONA_LABEL_MAX_LENGTH} autoFocus onChange={(event) => onChange({ ...draft, label: event.target.value })} />
      </FormField>

      {hasPersonaOptions(field.type) && (
        <PersonaOptionsEditor
          options={draft.options}
          onChange={(options) => onChange({ ...draft, options })}
          idPrefix="settings-persona"
          hint="Tắt một lựa chọn = ẩn khỏi lựa chọn mới; khách đã chọn vẫn giữ và hiển thị đúng. Đổi tên không làm mất dữ liệu cũ."
        />
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
