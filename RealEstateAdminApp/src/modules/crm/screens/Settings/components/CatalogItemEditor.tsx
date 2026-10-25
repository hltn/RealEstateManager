/**
 * Form sửa/thêm 1 mục danh mục (tình trạng, nguồn khách, khu vực). Trường hiển thị tuỳ loại danh mục.
 */
import type { FormEvent } from 'react';
import { useCatalogs } from '@crm/api';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, CARD_TITLE_CLASS, INSET_CLASS } from '@crm/lib/uiClasses';
import type { ListGroup, StatusTone } from '@crm/types/crm';
import { AREA_TYPE_OPTIONS, CATALOG_NAME_MAX_LENGTH, LIST_GROUP_OPTIONS, STATUS_TONE_OPTIONS, type AdminCatalogKind, type AreaType, type CatalogDraft } from '../settingsForms';

interface CatalogItemEditorProps {
  kind: AdminCatalogKind;
  draft: CatalogDraft;
  error: string | null;
  isSaving: boolean;
  onChange: (draft: CatalogDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}

const fieldId = (name: string) => `settings-catalog-${name}`;

interface SwitchRowProps {
  label: string;
  description: string;
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
}

export const SwitchRow = ({ label, description, isChecked, onChange }: SwitchRowProps) => (
  <div className="flex items-center justify-between gap-3">
    <div className="min-w-0">
      <p className="text-sm font-medium text-gray-800 dark:text-white/90">{label}</p>
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{description}</p>
    </div>
    <ToggleSwitch isChecked={isChecked} onChange={onChange} label={label} size="sm" />
  </div>
);

export const CatalogItemEditor = ({ kind, draft, error, isSaving, onChange, onSave, onCancel }: CatalogItemEditorProps) => {
  const { catalogs } = useCatalogs();
  const isNew = draft.id === null;
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };
  // Khu vực cha: mọi khu vực khác chính nó (backend chặn chuyển vào chính nó/nhánh con).
  const parentOptions = catalogs.areas.filter((area) => area.id !== draft.id).map((area) => ({ value: area.id, label: area.name }));

  return (
    <form onSubmit={handleSubmit} className={`${INSET_CLASS} space-y-4 p-4`} aria-label={isNew ? 'Thêm mục danh mục' : 'Sửa mục danh mục'}>
      <h3 className={CARD_TITLE_CLASS}>{isNew ? 'Thêm mới' : `Sửa "${draft.name}"`}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField inputId={fieldId('name')} label="Tên" isRequired>
          <TextInput id={fieldId('name')} value={draft.name} maxLength={CATALOG_NAME_MAX_LENGTH} autoFocus onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </FormField>

        {kind === 'statuses' && (
          <>
            <FormField inputId={fieldId('group')} label="Thuộc danh sách" hint={draft.isSystem ? 'Tình trạng hệ thống: không đổi được' : 'Quyết định khách hiện ở tab nào'}>
              <SelectInput id={fieldId('group')} value={draft.listGroup} options={LIST_GROUP_OPTIONS} disabled={draft.isSystem} onChange={(event) => onChange({ ...draft, listGroup: event.target.value as ListGroup })} />
            </FormField>
            <FormField inputId={fieldId('tone')} label="Màu hiển thị">
              <SelectInput id={fieldId('tone')} value={draft.tone} options={STATUS_TONE_OPTIONS} onChange={(event) => onChange({ ...draft, tone: event.target.value as StatusTone })} />
            </FormField>
          </>
        )}

        {kind === 'areas' && (
          <>
            {isNew && (
              <FormField inputId={fieldId('area-type')} label="Loại khu vực">
                <SelectInput id={fieldId('area-type')} value={draft.areaType} options={AREA_TYPE_OPTIONS} onChange={(event) => onChange({ ...draft, areaType: event.target.value as AreaType })} />
              </FormField>
            )}
            <FormField inputId={fieldId('parent')} label="Thuộc khu vực" hint="Bỏ trống = khu vực gốc (tỉnh/thành)">
              <SelectInput id={fieldId('parent')} value={draft.parentId} emptyLabel="— Khu vực gốc —" options={parentOptions} onChange={(event) => onChange({ ...draft, parentId: event.target.value })} />
            </FormField>
          </>
        )}

        <FormField inputId={fieldId('order')} label="Thứ tự hiển thị">
          <TextInput
            id={fieldId('order')}
            type="number"
            min={0}
            value={draft.order}
            onChange={(event) => onChange({ ...draft, order: Math.max(0, Number(event.target.value) || 0) })}
          />
        </FormField>
      </div>

      {!isNew && (
        <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-white/[0.05]">
          {kind === 'statuses' && (
            <SwitchRow
              label="Mặc định cho khách mới"
              description="Chỉ 1 tình trạng; phải thuộc danh sách Chưa tiếp cận"
              isChecked={draft.isDefault}
              onChange={(isDefault) => onChange({ ...draft, isDefault })}
            />
          )}
          <SwitchRow
            label="Đang dùng"
            description="Tắt = ẩn khỏi lựa chọn mới; khách đã gắn vẫn giữ và hiển thị đúng"
            isChecked={draft.isActive}
            onChange={(isActive) => onChange({ ...draft, isActive })}
          />
        </div>
      )}

      <FieldError id={fieldId('error')} message={error ?? undefined} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={BUTTON_OUTLINE_CLASS}>
          Huỷ
        </button>
        <button type="submit" disabled={isSaving} className={BUTTON_PRIMARY_CLASS}>
          {isSaving ? 'Đang lưu…' : isNew ? 'Thêm' : 'Lưu'}
        </button>
      </div>
    </form>
  );
};
