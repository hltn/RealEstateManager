/**
 * Các trường của dự án ngoài "Tên" (mã, chủ đầu tư, vị trí, khu vực, loại hình, khoảng giá, trạng thái). Backend không có tên đầy đủ/đơn vị giá/phân khúc.
 * Dùng chung dialog Thêm/Sửa ở màn Dự án và form trong tab Dự án của Cài đặt (DRY). Ô "Tên ngắn" do nơi dùng tự vẽ.
 */
import type { ChangeEvent } from 'react';
import { FormField, getErrorId } from '@crm/components/form/FormField';
import { FieldError, getFieldA11yProps } from '@crm/components/form/FieldError';
import { MultiChoiceChips } from '@crm/components/form/MultiChoiceChips';
import { SelectInput } from '@crm/components/form/SelectInput';
import { TextInput } from '@crm/components/form/TextInput';
import {
  PROJECT_CODE_MAX_LENGTH,
  PROJECT_FIELD_MAX_LENGTH,
  PROJECT_STATUS_OPTIONS,
  PROJECT_TYPES_MAX_COUNT,
  toPropertyTypeLabels,
  type ProjectErrors,
  type ProjectField,
  type ProjectPropertyTypeOption,
} from '@crm/lib/projectRules';
import { CHIP_SMALL_CLASS, CHIP_TONE_CLASS } from '@crm/lib/uiClasses';
import type { Area, Project, ProjectStatus } from '@crm/types/crm';

const MILLION = 1_000_000;

/** VNĐ -> ô nhập theo "triệu đồng" (null -> rỗng). */
const toMillionInput = (vnd: number | null): string => (vnd === null ? '' : String(Math.round((vnd / MILLION) * 1000) / 1000));
/** Ô nhập "triệu đồng" -> VNĐ (rỗng/không phải số -> null). */
const fromMillionInput = (value: string): number | null => {
  if (!value.trim()) return null;
  const million = Number(value);
  return Number.isFinite(million) ? Math.round(million * MILLION) : null;
};

interface ProjectFormFieldsProps {
  project: Project;
  areas: readonly Area[];
  errors?: ProjectErrors;
  /** Tiền tố id để nhiều form không trùng id. */
  idPrefix: string;
  /** Lựa chọn loại hình (danh mục `property_type`, FR-46); lựa chọn đã tắt chỉ có mặt khi dự án đang dùng (`listProjectPropertyTypeOptions`). */
  propertyTypeOptions?: readonly ProjectPropertyTypeOption[];
  /** Q1: mã dự án bất biến sau khi tạo -> chỉ đọc khi Sửa. */
  isCodeReadOnly?: boolean;
  onChange: (project: Project) => void;
}

const EMPTY_OPTIONS: readonly ProjectPropertyTypeOption[] = [];

export const ProjectFormFields = ({ project, areas, errors = {}, idPrefix, propertyTypeOptions = EMPTY_OPTIONS, isCodeReadOnly = false, onChange }: ProjectFormFieldsProps) => {
  const fieldId = (name: string) => `${idPrefix}-${name}`;
  const text = (field: 'developer' | 'location', label: string) => (
    <FormField inputId={fieldId(field)} label={label} error={errors[field]}>
      <TextInput
        id={fieldId(field)}
        value={project[field]}
        maxLength={PROJECT_FIELD_MAX_LENGTH}
        hasError={Boolean(errors[field])}
        onChange={(event) => onChange({ ...project, [field]: event.target.value })}
        {...getFieldA11yProps(getErrorId(fieldId(field)), errors[field])}
      />
    </FormField>
  );
  /**
   * Ô Mã: tự viết HOA ngay khi gõ nhưng KHÔNG cắt ký tự lạ (cắt khi gõ sẽ làm vỡ bộ gõ tiếng Việt; ký tự sai báo lỗi lúc Lưu).
   * Giữ vị trí con trỏ khi đổi chữ thường -> HOA ở giữa chuỗi; đang gõ dở bộ gõ (composition) thì để nguyên, chuyển HOA khi kết thúc.
   * Bàn phím di động (Gboard/iOS) giữ composition nên thêm `uppercase` (CSS, chỉ hiển thị) + `autoCapitalize` để ô luôn trông là chữ HOA;
   * dữ liệu vẫn được chuẩn hoá HOA lúc lưu (`normalizeProject`).
   */
  const commitCode = (input: HTMLInputElement) => {
    const upper = input.value.toUpperCase();
    if (upper !== input.value) {
      const { selectionStart, selectionEnd } = input;
      input.value = upper;
      input.setSelectionRange(selectionStart, selectionEnd);
    }
    onChange({ ...project, code: upper });
  };
  const handleCodeChange = (event: ChangeEvent<HTMLInputElement>) => {
    if ((event.nativeEvent as InputEvent).isComposing) onChange({ ...project, code: event.target.value });
    else commitCode(event.target);
  };
  const codeField = (
    <FormField
      inputId={fieldId('code')}
      label="Mã dự án"
      isRequired
      error={errors.code}
      hint={isCodeReadOnly ? 'Mã dự án không đổi được sau khi tạo.' : 'Chữ và số viết liền, không dấu, không trùng. VD: QTERRA'}
    >
      <TextInput
        id={fieldId('code')}
        value={project.code}
        maxLength={PROJECT_CODE_MAX_LENGTH}
        className="uppercase"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        hasError={Boolean(errors.code)}
        readOnly={isCodeReadOnly}
        onChange={handleCodeChange}
        onCompositionEnd={(event) => commitCode(event.currentTarget)}
        {...getFieldA11yProps(getErrorId(fieldId('code')), errors.code)}
      />
    </FormField>
  );
  const selectedCodes = project.propertyTypeCodes ?? [];
  const unmapped = project.unmappedPropertyTypes ?? [];
  const typeErrorId = getErrorId(fieldId('property-types'));
  const propertyTypeChoices = propertyTypeOptions.map((option) => ({ value: option.value, label: option.isActive ? option.label : `${option.label} (đã tắt)` }));
  // Chọn loại hình: giữ cả mã lẫn nhãn trong nháp (nhãn để thẻ dự án/xem trước nhất quán), nhưng chỉ MÃ được gửi lên (`toProjectBody`).
  const handlePropertyTypesChange = (codes: string[]) => onChange({ ...project, propertyTypeCodes: codes, propertyTypes: toPropertyTypeLabels(codes, propertyTypeOptions) });
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
      {codeField}
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
      <div className="space-y-2 sm:col-span-2" id={fieldId('property-types')}>
        <MultiChoiceChips
          legend="Loại hình"
          options={propertyTypeChoices}
          values={selectedCodes}
          onChange={handlePropertyTypesChange}
          emptyMessage="Chưa có loại hình nào trong danh mục. Thêm lựa chọn ở Cài đặt > Trường chân dung > Loại hình."
          hint={`Chọn nhiều loại (tối đa ${PROJECT_TYPES_MAX_COUNT}). Danh mục lấy từ trường "Loại hình" ở Cài đặt.`}
        />
        <FieldError id={typeErrorId} message={errors.propertyTypes} />
        {unmapped.length > 0 && (
          <div role="status" className="space-y-1.5 rounded-lg bg-warning-50 p-3 text-theme-xs text-warning-700 dark:bg-warning-500/10 dark:text-warning-500" data-testid="project-unmapped-property-types">
            <p>
              Có {unmapped.length} loại hình cũ chưa khớp lựa chọn nào trong danh mục. Chọn lại loại hình ở trên rồi lưu để thay thế các chữ này.
            </p>
            <ul className="flex flex-wrap gap-1.5" aria-label="Loại hình cũ chưa khớp">
              {unmapped.map((text) => (
                <li key={text} className={`${CHIP_SMALL_CLASS} ${CHIP_TONE_CLASS.warning} border border-warning-200 dark:border-warning-500/30`}>
                  {text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
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
    </>
  );
};
