import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmCatalogs, PersonaFieldDefinition } from '@crm/types/crm';
import { DEFAULT_FILTERS } from '@crm/store/crmReducer';
import { AdvancedFilterModal } from './AdvancedFilterModal';

const catalogs: CrmCatalogs = { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults: [] };

const baseField: Omit<PersonaFieldDefinition, 'key' | 'label' | 'type'> = {
  groupCode: 'REAL_ESTATE',
  weight: 1,
  suggestPriority: 1,
  isFilterable: true,
  isOccasion: false,
  linkedCriterion: null,
  isActive: true,
};

const personaFieldsState: { value: PersonaFieldDefinition[] } = { value: [] };

vi.mock('@crm/api', () => ({
  useCatalogs: () => ({ catalogs, users: [], personaFields: personaFieldsState.value }),
  useAssigneeFilterOptions: () => [],
  useProjectFilterOptions: () => [],
}));

const fields: PersonaFieldDefinition[] = [
  {
    ...baseField,
    key: 'property_type',
    label: 'Loại hình quan tâm',
    type: 'MULTI_SELECT',
    optionItems: [
      { value: 'APT', label: 'Căn hộ', isActive: true },
      { value: 'VILLA', label: 'Biệt thự', isActive: true },
      { value: 'OLD', label: 'Loại cũ', isActive: false },
    ],
  },
  { ...baseField, key: 'loan_support', label: 'Cần hỗ trợ vay', type: 'BOOLEAN' },
  { ...baseField, key: 'hobby', label: 'Sở thích riêng', type: 'SELECT', isFilterable: false, optionItems: [{ value: 'GOLF', label: 'Golf', isActive: true }] },
  { ...baseField, key: 'budget', label: 'Ngân sách', type: 'NUMBER_RANGE' },
];

const setup = (personaFilters: string[] = [], overrides: Partial<typeof DEFAULT_FILTERS> = {}) => {
  const onApply = vi.fn();
  const onReset = vi.fn();
  render(<AdvancedFilterModal filters={{ ...DEFAULT_FILTERS, personaFilters, ...overrides }} variant="sheet" onApply={onApply} onReset={onReset} onClose={vi.fn()} />);
  const apply = () => fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
  const group = (name: string) => screen.getByRole('group', { name });
  return { onApply, onReset, apply, group };
};

describe('AdvancedFilterModal: khối lọc chân dung (FR-49)', () => {
  beforeEach(() => {
    personaFieldsState.value = fields;
  });

  it('hiện trường lọc được với lựa chọn đang bật; trường không lọc được, kiểu số và lựa chọn đã tắt thì ẩn', () => {
    const { group } = setup();
    expect(within(group('Loại hình quan tâm')).getByRole('button', { name: 'Căn hộ' })).toBeInTheDocument();
    expect(within(group('Loại hình quan tâm')).getByRole('button', { name: 'Biệt thự' })).toBeInTheDocument();
    expect(within(group('Loại hình quan tâm')).queryByRole('button', { name: 'Loại cũ' })).not.toBeInTheDocument();
    expect(within(group('Cần hỗ trợ vay')).getAllByRole('button').map((button) => button.textContent)).toEqual(['Có', 'Không']);
    expect(screen.queryByRole('group', { name: 'Sở thích riêng' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Ngân sách' })).not.toBeInTheDocument();
  });

  it('không có trường lọc được thì không hiện khối', () => {
    personaFieldsState.value = [fields[2]];
    setup();
    expect(screen.queryByTestId('persona-filter-block')).not.toBeInTheDocument();
  });

  it('chọn một giá trị rồi Áp dụng: personaFilters = ["fieldKey:mã"]', () => {
    const { group, apply, onApply } = setup();
    fireEvent.click(within(group('Loại hình quan tâm')).getByRole('button', { name: 'Căn hộ' }));
    apply();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ personaFilters: ['property_type:APT'] }));
  });

  it('chọn nhiều giá trị cùng trường và khác trường; bỏ chọn một giá trị', () => {
    const { group, apply, onApply } = setup();
    const propertyGroup = within(group('Loại hình quan tâm'));
    fireEvent.click(propertyGroup.getByRole('button', { name: 'Căn hộ' }));
    fireEvent.click(propertyGroup.getByRole('button', { name: 'Biệt thự' }));
    fireEvent.click(within(group('Cần hỗ trợ vay')).getByRole('button', { name: 'Có' }));
    fireEvent.click(propertyGroup.getByRole('button', { name: 'Căn hộ' }));
    apply();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ personaFilters: ['property_type:VILLA', 'loan_support:true'] }));
  });

  it('kết hợp với bộ lọc khác: giữ nguyên các bộ lọc có sẵn', () => {
    const { group, apply, onApply } = setup([], { occupation: 'kế toán', tagIds: ['t1'], progress: [50] });
    fireEvent.click(within(group('Cần hỗ trợ vay')).getByRole('button', { name: 'Không' }));
    apply();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ occupation: 'kế toán', tagIds: ['t1'], progress: [50], personaFilters: ['loan_support:false'] }));
  });

  it('lựa chọn đang lọc được đánh dấu đã chọn, kể cả lựa chọn đã tắt (còn bỏ chọn được)', () => {
    const { group, apply, onApply } = setup(['property_type:APT', 'property_type:OLD']);
    const propertyGroup = within(group('Loại hình quan tâm'));
    expect(propertyGroup.getByRole('button', { name: 'Căn hộ' })).toHaveAttribute('aria-pressed', 'true');
    expect(propertyGroup.getByRole('button', { name: 'Biệt thự' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(propertyGroup.getByRole('button', { name: 'Loại cũ' }));
    apply();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ personaFilters: ['property_type:APT'] }));
  });

  it('"Thiết lập lại" xóa bộ lọc chân dung ở bản nháp rồi gọi onReset', () => {
    const { group, apply, onApply, onReset } = setup(['property_type:APT']);
    fireEvent.click(screen.getByRole('button', { name: /Thiết lập lại/ }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(within(group('Loại hình quan tâm')).getByRole('button', { name: 'Căn hộ' })).toHaveAttribute('aria-pressed', 'false');
    apply();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ personaFilters: [] }));
  });

  it('trường bị tắt lọc sau khi đã chọn: Áp dụng gỡ giá trị mồ côi, giữ trường còn lọc được', () => {
    const { apply, onApply } = setup(['hobby:GOLF', 'property_type:APT']);
    apply();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ personaFilters: ['property_type:APT'] }));
  });

  it('danh sách trường chưa tải (rỗng) thì không xóa nhầm bộ lọc đang có', () => {
    personaFieldsState.value = [];
    const { apply, onApply } = setup(['property_type:APT']);
    apply();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ personaFilters: ['property_type:APT'] }));
  });
});
