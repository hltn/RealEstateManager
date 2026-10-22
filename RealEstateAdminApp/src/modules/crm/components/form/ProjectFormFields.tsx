/**
 * Các trường của dự án ngoài "Tên ngắn" (mã, tên đầy đủ, chủ đầu tư, vị trí, khu vực, loại hình, khoảng giá, trạng thái, phân khúc).
 * Dùng chung dialog Thêm/Sửa ở màn Dự án và form trong tab Dự án của Cài đặt (DRY). Ô "Tên ngắn" do nơi dùng tự vẽ.
 */
import { useState } from 'react';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { getFieldA11yProps } from '@crm/components/form/FieldError';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import {
  PROJECT_CODE_MAX_LENGTH,
  PROJECT_FIELD_MAX_LENGTH,
  PROJECT_PRICE_UNIT_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  type ProjectErrors,
  type ProjectField,
} from '@crm/lib/projectRules';
import type { Area, Project, ProjectPriceUnit, ProjectStatus } from '@crm/types/crm';

const MILLION = 1_000_000;

/** VNĐ -> ô nhập theo "triệu đồng" (null -> rỗng). */
const toMillionInput = (vnd: number | null): string => (vnd === null ? '' : String(Math.round((vnd / MILLION) * 1000) / 1000));
/** Ô nhập "triệu đồng" -> VNĐ (rỗng/không phải số -> null). */
const fromMillionInput = (value: string): number | null => {
  if (!value.trim()) return null;
  const million = Number(value);
  return Number.isFinite(million) ? Math.round(million * MILLION) : null;
};

interface PropertyTypesInputProps {
  id: string;
  value: readonly string[];
  hasError: boolean;
  onChange: (propertyTypes: string[]) => void;
}

/** Ô nhập nhiều loại hình cách nhau bằng dấu phẩy: giữ CHỮ đang gõ trong state cục bộ (để gõ dấu phẩy không bị nuốt), đẩy mảng đã tách lên form. */
const PropertyTypesInput = ({ id, value, hasError, onChange, ...a11yProps }: PropertyTypesInputProps & Record<string, unknown>) => {
  const [text, setText] = useState(() => value.join(', '));
  return (
    <TextInput
      id={id}
      value={text}
      hasError={hasError}
      onChange={(event) => {
        setText(event.target.value);
        onChange(event.target.value.split(',').map((part) => part.trim()).filter(Boolean));
      }}
      {...a11yProps}
    />
  );
};

interface ProjectFormFieldsProps {
  project: Project;
  areas: readonly Area[];
  errors?: ProjectErrors;
  /** Tiền tố id để nhiều form không trùng id. */
  idPrefix: string;
  onChange: (project: Project) => void;
}

export const ProjectFormFields = ({ project, areas, errors = {}, idPrefix, onChange }: ProjectFormFieldsProps) => {
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const text = (field: 'code' | 'developer' | 'location', label: string, options: { isRequired?: boolean; hint?: string; maxLength?: number } = {}) => (
    <FormField inputId={fieldId(field)} label={label} isRequired={options.isRequired} error={errors[field]} hint={options.hint}>
      <TextInput
        id={fieldId(field)}
        value={project[field]}
        maxLength={options.maxLength ?? PROJECT_FIELD_MAX_LENGTH}
        hasError={Boolean(errors[field])}
        onChange={(event) => onChange({ ...project, [field]: event.target.value })}
        {...getFieldA11yProps(getErrorId(fieldId(field)), errors[field])}
      />
    </FormField>
  );
  const price = (field: Extract<ProjectField, 'priceFrom' | 'priceTo'>, label: string) => (
    <FormField inputId={fieldId(field)} label={label} error={errors[field]} hint="Đơn vị: triệu đồng (3500 = 3,5 tỷ)">
      <TextInput
        id={fieldId(field)}
        type="number"
        min={0}
        step="any"
        value={toMillionInput(project[field])}
        hasError={Boolean(errors[field])}
        onChange={(event) => onChange({ ...project, [field]: fromMillionInput(event.target.value) })}
        {...getFieldA11yProps(getErrorId(fieldId(field)), errors[field])}
      />
    </FormField>
  );

  return (
    <>
      {text('code', 'Mã dự án', { isRequired: true, hint: 'Viết hoa, không trùng. VD: QTERRA', maxLength: PROJECT_CODE_MAX_LENGTH })}
      <FormField inputId={fieldId('full-name')} label="Tên đầy đủ" hint="Bỏ trống = dùng tên ngắn">
        <TextInput id={fieldId('full-name')} value={project.fullName} maxLength={160} onChange={(event) => onChange({ ...project, fullName: event.target.value })} />
      </FormField>
      {text('developer', 'Chủ đầu tư')}
      {text('location', 'Vị trí / địa chỉ')}
      <FormField inputId={fieldId('area')} label="Khu vực">
        <SelectInput
          id={fieldId('area')}
          value={project.areaId ?? ''}
          emptyLabel="Chưa chọn"
          options={areas.map((area) => ({ value: area.id, label: area.isActive ? area.name : `${area.name} (đã ẩn)` }))}
          onChange={(event) => onChange({ ...project, areaId: event.target.value || null })}
        />
      </FormField>
      <FormField inputId={fieldId('property-types')} label="Loại hình" error={errors.propertyTypes} hint="Nhiều loại cách nhau bằng dấu phẩy. VD: Căn hộ, Shophouse">
        <PropertyTypesInput
          id={fieldId('property-types')}
          value={project.propertyTypes}
          hasError={Boolean(errors.propertyTypes)}
          onChange={(propertyTypes) => onChange({ ...project, propertyTypes })}
          {...getFieldA11yProps(getErrorId(fieldId('property-types')), errors.propertyTypes)}
        />
      </FormField>
      <FormField inputId={fieldId('price-unit')} label="Đơn vị giá">
        <SelectInput
          id={fieldId('price-unit')}
          value={project.priceUnit}
          options={PROJECT_PRICE_UNIT_OPTIONS}
          onChange={(event) => onChange({ ...project, priceUnit: event.target.value as ProjectPriceUnit })}
        />
      </FormField>
      {price('priceFrom', 'Giá từ')}
      {price('priceTo', 'Giá đến')}
      <FormField inputId={fieldId('status')} label="Trạng thái bán hàng">
        <SelectInput
          id={fieldId('status')}
          value={project.status ?? ''}
          emptyLabel="Chưa cập nhật"
          options={PROJECT_STATUS_OPTIONS}
          onChange={(event) => onChange({ ...project, status: (event.target.value || null) as ProjectStatus | null })}
        />
      </FormField>
      <FormField inputId={fieldId('segment')} label="Phân khúc">
        <TextInput id={fieldId('segment')} value={project.segment} maxLength={60} onChange={(event) => onChange({ ...project, segment: event.target.value })} />
      </FormField>
    </>
  );
};
