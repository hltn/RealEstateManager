/**
 * Form sửa/thêm 1 mục danh mục (tình trạng, nguồn khách, khu vực, dự án). Trường hiển thị tuỳ loại danh mục.
 */
import type { FormEvent } from 'react';
import type { AdminCatalogKind } from '@crm/api';
import { useCatalogs } from '@crm/api';
import { FieldError } from '@crm/components/form/FieldError';
import { FormField } from '@crm/components/form/FormField';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import { ToggleSwitch } from '@crm/components/form/ToggleSwitch';
import { BUTTON_OUTLINE_CLASS, BUTTON_PRIMARY_CLASS, CARD_TITLE_CLASS, INSET_CLASS } from '@crm/lib/uiClasses';
import type { ListGroup, StatusTone } from '@crm/types/crm';
import { LIST_GROUP_OPTIONS, STATUS_TONE_OPTIONS, type AdminCatalogItem } from '../settingsForms';

interface CatalogItemEditorProps {
  kind: AdminCatalogKind;
  item: AdminCatalogItem;
  isNew: boolean;
  error: string | null;
  onChange: (item: AdminCatalogItem) => void;
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

export const CatalogItemEditor = ({ kind, item, isNew, error, onChange, onSave, onCancel }: CatalogItemEditorProps) => {
  const { catalogs } = useCatalogs();
  const name = 'label' in item ? item.label : item.name;
  const setName = (value: string) => onChange('label' in item ? { ...item, label: value } : { ...item, name: value });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className={`${INSET_CLASS} space-y-4 p-4`} aria-label={isNew ? 'Thêm mục danh mục' : 'Sửa mục danh mục'}>
      <h3 className={CARD_TITLE_CLASS}>{isNew ? 'Thêm mới' : `Sửa "${name}"`}</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField inputId={fieldId('name')} label={kind === 'projects' ? 'Tên ngắn' : 'Tên'} isRequired>
          <TextInput id={fieldId('name')} value={name} maxLength={80} autoFocus onChange={(event) => setName(event.target.value)} />
        </FormField>

        {'listGroup' in item && (
          <>
            <FormField inputId={fieldId('group')} label="Thuộc danh sách" hint="Quyết định khách hiện ở tab nào">
              <SelectInput
                id={fieldId('group')}
                value={item.listGroup}
                options={LIST_GROUP_OPTIONS}
                onChange={(event) => onChange({ ...item, listGroup: event.target.value as ListGroup })}
              />
            </FormField>
            <FormField inputId={fieldId('tone')} label="Màu hiển thị">
              <SelectInput id={fieldId('tone')} value={item.tone} options={STATUS_TONE_OPTIONS} onChange={(event) => onChange({ ...item, tone: event.target.value as StatusTone })} />
            </FormField>
          </>
        )}

        {'order' in item && (
          <FormField inputId={fieldId('order')} label="Thứ tự hiển thị">
            <TextInput
              id={fieldId('order')}
              type="number"
              min={1}
              value={item.order}
              onChange={(event) => onChange({ ...item, order: Math.max(1, Number(event.target.value) || 1) })}
            />
          </FormField>
        )}

        {'fullName' in item && (
          <>
            <FormField inputId={fieldId('code')} label="Mã dự án" hint="Không bắt buộc; viết hoa, không trùng">
              <TextInput id={fieldId('code')} value={item.code} maxLength={20} onChange={(event) => onChange({ ...item, code: event.target.value })} />
            </FormField>
            <FormField inputId={fieldId('full-name')} label="Tên đầy đủ" hint="Bỏ trống = dùng tên ngắn">
              <TextInput id={fieldId('full-name')} value={item.fullName} maxLength={160} onChange={(event) => onChange({ ...item, fullName: event.target.value })} />
            </FormField>
            <FormField inputId={fieldId('location')} label="Địa chỉ / văn phòng bán hàng">
              <TextInput id={fieldId('location')} value={item.location} maxLength={200} onChange={(event) => onChange({ ...item, location: event.target.value })} />
            </FormField>
            <FormField inputId={fieldId('area')} label="Khu vực">
              <SelectInput
                id={fieldId('area')}
                value={item.areaId ?? ''}
                emptyLabel="Chưa chọn"
                options={catalogs.areas.map((area) => ({ value: area.id, label: area.isActive ? area.name : `${area.name} (đã ẩn)` }))}
                onChange={(event) => onChange({ ...item, areaId: event.target.value || null })}
              />
            </FormField>
            <FormField inputId={fieldId('price')} label="Khoảng giá" hint="VD: 3,5 – 6 tỷ">
              <TextInput id={fieldId('price')} value={item.priceText} maxLength={60} onChange={(event) => onChange({ ...item, priceText: event.target.value })} />
            </FormField>
            <FormField inputId={fieldId('status')} label="Trạng thái bán hàng" hint='VD: "Đang mở bán", "Sắp mở bán"'>
              <TextInput id={fieldId('status')} value={item.statusLabel} maxLength={60} onChange={(event) => onChange({ ...item, statusLabel: event.target.value })} />
            </FormField>
            <FormField inputId={fieldId('segment')} label="Phân khúc">
              <TextInput id={fieldId('segment')} value={item.segment} maxLength={60} onChange={(event) => onChange({ ...item, segment: event.target.value })} />
            </FormField>
          </>
        )}
      </div>

      <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-white/[0.05]">
        {'isDefault' in item && (
          <SwitchRow
            label="Mặc định cho khách mới"
            description="Chỉ 1 tình trạng; phải thuộc danh sách Đang chăm sóc"
            isChecked={item.isDefault}
            onChange={(isDefault) => onChange({ ...item, isDefault })}
          />
        )}
        <SwitchRow
          label="Đang dùng"
          description="Tắt = ẩn khỏi lựa chọn mới; khách đã gắn vẫn giữ và hiển thị đúng"
          isChecked={item.isActive}
          onChange={(isActive) => onChange({ ...item, isActive })}
        />
      </div>

      <FieldError id={fieldId('error')} message={error ?? undefined} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={BUTTON_OUTLINE_CLASS}>
          Huỷ
        </button>
        <button type="submit" className={BUTTON_PRIMARY_CLASS}>
          {isNew ? 'Thêm' : 'Lưu'}
        </button>
      </div>
    </form>
  );
};
