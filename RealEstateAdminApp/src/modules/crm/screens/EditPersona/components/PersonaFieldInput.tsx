/**
 * Ô nhập 1 trường chân dung theo kiểu cấu hình (X10): TEXT, TEXTAREA, DATE, SELECT, MULTI_SELECT, BOOLEAN, NUMBER_RANGE.
 * Thêm/bớt trường ở cấu hình là form tự đổi, không phải sửa code giao diện.
 */
import { BudgetRangeInput } from '@crm/components/form/BudgetRangeInput';
import { ChipMultiSelect } from '@crm/components/form/ChoiceGroup';
import { FormField } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TagInput } from '@crm/components/form/TagInput';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { CRITERION_LABELS } from '@crm/lib/customerRules';
import { addUniqueItem } from '../../CreateCustomer/customerFormRules';
import { getTextareaClass } from '@crm/lib/uiClasses';
import type { PersonaFieldDefinition } from '@crm/types/crm';
import type { PersonaDraftValue } from '../personaForm';

interface PersonaFieldInputProps {
  field: PersonaFieldDefinition;
  value: PersonaDraftValue;
  idPrefix: string;
  error?: string;
  onChange: (value: PersonaDraftValue) => void;
}

export const PersonaFieldInput = ({ field, value, idPrefix, error, onChange }: PersonaFieldInputProps) => {
  const inputId = `${idPrefix}-${field.key}`;
  const hint = field.linkedCriterion ? `Liên quan tiêu chí ${CRITERION_LABELS[field.linkedCriterion]} (không tự đánh dấu đạt)` : undefined;
  const set = (changes: Partial<PersonaDraftValue>) => onChange({ ...value, ...changes });

  switch (field.type) {
    case 'NUMBER_RANGE':
      return (
        <BudgetRangeInput
          idPrefix={inputId}
          budgetMin={value.from}
          budgetMax={value.to}
          onChangeMin={(from) => set({ from })}
          onChangeMax={(to) => set({ to })}
          errorMax={error}
          hint={hint}
        />
      );
    case 'MULTI_SELECT':
      return field.options && field.options.length > 0 ? (
        <ChipMultiSelect
          legend={field.label}
          options={field.options}
          selected={value.options}
          onToggle={(option) => set({ options: value.options.includes(option) ? value.options.filter((item) => item !== option) : [...value.options, option] })}
        />
      ) : (
        <TagInput
          inputId={inputId}
          label={field.label}
          tags={value.options}
          onAdd={(raw) => set({ options: addUniqueItem(value.options, raw) })}
          onRemove={(tag) => set({ options: value.options.filter((item) => item !== tag) })}
          placeholder="Nhập rồi bấm Enter"
          emptyText="Chưa có."
        />
      );
    case 'BOOLEAN':
      return (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{field.label}</span>
          <ToggleSwitch isChecked={value.isOn} onChange={(isOn) => set({ isOn })} label={field.label} size="sm" />
        </div>
      );
    default:
      return (
        <FormField inputId={inputId} label={field.label} error={error} hint={hint}>
          {field.type === 'SELECT' ? (
            <SelectInput id={inputId} emptyLabel="— Chưa rõ —" options={field.options ?? []} value={value.text} onChange={(event) => set({ text: event.target.value })} />
          ) : field.type === 'TEXTAREA' ? (
            <textarea id={inputId} rows={3} value={value.text} onChange={(event) => set({ text: event.target.value })} placeholder={field.placeholder} className={getTextareaClass(Boolean(error))} />
          ) : field.type === 'DATE' ? (
            <TextInput id={inputId} type="date" value={value.date} max="2100-12-31" onChange={(event) => set({ date: event.target.value })} className="dark:[color-scheme:dark]" />
          ) : (
            <TextInput id={inputId} value={value.text} maxLength={2000} onChange={(event) => set({ text: event.target.value })} placeholder={field.placeholder} />
          )}
        </FormField>
      );
  }
};
