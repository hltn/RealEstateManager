/**
 * Form dự án (T-67, FR-46 + FR-40 + Q1): loại hình chọn nhiều từ danh mục `property_type`, cảnh báo `unmappedPropertyTypes`,
 * khu vực gửi theo `areaCode`, mã dự án chỉ đọc khi Sửa và đổi tên lựa chọn không làm hỏng dự án (dự án lưu MÃ, không lưu nhãn).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonaFieldDefinition, Project } from '@crm/types/crm';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { ProjectFormDialog } from './ProjectFormDialog';

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'QTERRA',
  code: 'QTerra',
  name: 'QTerra Residence',
  fullName: 'QTerra Residence',
  developer: '',
  location: '',
  areaId: null,
  propertyTypes: [],
  priceFrom: null,
  priceTo: null,
  priceUnit: 'TOTAL',
  status: 'SELLING',
  segment: '',
  isActive: true,
  deletedAt: null,
  ...overrides,
});

const propertyTypeField = (items: { value: string; label: string; isActive: boolean }[]): PersonaFieldDefinition => ({
  key: 'property_type',
  label: 'Loại hình',
  groupCode: 'REAL_ESTATE',
  type: 'MULTI_SELECT',
  options: items.filter((item) => item.isActive).map((item) => item.label),
  optionItems: items,
  weight: 1,
  suggestPriority: 1,
  isFilterable: true,
  isOccasion: false,
  linkedCriterion: null,
  isActive: true,
});

const OPTIONS = [
  { value: 'APT', label: 'Căn hộ', isActive: true },
  { value: 'TOWN', label: 'Nhà phố', isActive: true },
  { value: 'VILLA', label: 'Biệt thự', isActive: true },
  { value: 'OLD', label: 'Loại cũ', isActive: false },
];

const api = { createProject: vi.fn(), updateProject: vi.fn() };
const state = { personaFields: [] as PersonaFieldDefinition[] };
const AREAS = [{ id: 'HA_NOI', name: 'Hà Nội', isActive: true, order: 1 }];

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => api,
    useCatalogs: () => ({
      catalogs: { statuses: [], leadSources: [], areas: AREAS, projects: [], tags: [], contactResults: [] },
      personaFields: state.personaFields,
      users: [],
    }),
  };
});

const setup = (editing: Project | null = null) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <ProjectFormDialog project={editing} onClose={vi.fn()} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

const chip = (name: string) => screen.queryByRole('checkbox', { name }) as HTMLInputElement | null;
const requireChip = (name: string) => {
  const element = chip(name);
  if (!element) throw new Error(`Không thấy lựa chọn "${name}"`);
  return element;
};
const codeInput = () => screen.getByLabelText(/Mã dự án/) as HTMLInputElement;
const nameInput = () => screen.getByLabelText(/Tên dự án/) as HTMLInputElement;
const submitEdit = () => fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.updateProject.mockResolvedValue({ ok: true, data: project() });
  api.createProject.mockResolvedValue({ ok: true, data: project({ id: 'SKY', code: 'SKY', name: 'Sky' }) });
  state.personaFields = [propertyTypeField(OPTIONS)];
});

describe('Loại hình chọn nhiều từ danh mục property_type (FR-46)', () => {
  it('hiện các lựa chọn đang dùng dạng checkbox; thêm dự án gửi propertyTypeCodes (mã), không gửi nhãn', async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole('group', { name: /Loại hình/ })).toBeInTheDocument();
    await user.type(nameInput(), 'Sky');
    await user.click(requireChip('Căn hộ'));
    await user.click(requireChip('Biệt thự'));
    expect(requireChip('Căn hộ').checked).toBe(true);
    expect(requireChip('Nhà phố').checked).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    const body = api.createProject.mock.calls[0][0];
    expect(body.propertyTypeCodes).toEqual(['APT', 'VILLA']);
    expect(body).not.toHaveProperty('propertyTypes');
  });

  it('thêm dự án không chọn loại hình: gửi propertyTypeCodes rỗng', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky');
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][0].propertyTypeCodes).toEqual([]);
  });

  it('lựa chọn đã tắt KHÔNG hiện ở form thêm mới', () => {
    setup();
    expect(chip('Loại cũ')).toBeNull();
    expect(chip('Loại cũ (đã tắt)')).toBeNull();
  });

  it('Sửa dự án đang dùng lựa chọn đã tắt: vẫn hiện (đánh dấu đã tắt) và đang được chọn; dự án khác không thấy', () => {
    setup(project({ propertyTypeCodes: ['OLD'], propertyTypes: ['Loại cũ'] }));
    expect(requireChip('Loại cũ (đã tắt)').checked).toBe(true);
  });

  it('Sửa dự án KHÔNG dùng lựa chọn đã tắt: không hiện lựa chọn đó', () => {
    setup(project({ propertyTypeCodes: ['APT'], propertyTypes: ['Căn hộ'] }));
    expect(chip('Loại cũ (đã tắt)')).toBeNull();
    expect(requireChip('Căn hộ').checked).toBe(true);
  });

  it('danh mục property_type trống: báo chưa có loại hình, không có checkbox nào', () => {
    state.personaFields = [];
    setup();
    expect(screen.getByText(/Chưa có loại hình nào trong danh mục/)).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('chọn quá 10 loại hình: báo lỗi và không gọi API', async () => {
    state.personaFields = [propertyTypeField(Array.from({ length: 11 }, (_, index) => ({ value: `T${index}`, label: `Loại ${index}`, isActive: true })))];
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky');
    for (let index = 0; index < 11; index += 1) await user.click(requireChip(`Loại ${index}`));
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tối đa 10 loại hình.');
    expect(api.createProject).not.toHaveBeenCalled();
  });
});

describe('unmappedPropertyTypes (FR-46)', () => {
  const withUnmapped = () => project({ propertyTypeCodes: ['APT'], propertyTypes: ['Căn hộ', 'Biệt thự song lập'], unmappedPropertyTypes: ['Biệt thự song lập', 'Condotel'] });

  it('hiện cảnh báo và chip cho từng chữ cũ chưa khớp', () => {
    setup(withUnmapped());
    const warning = screen.getByTestId('project-unmapped-property-types');
    expect(warning).toHaveTextContent('Có 2 loại hình cũ chưa khớp');
    const items = within(within(warning).getByRole('list', { name: 'Loại hình cũ chưa khớp' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Biệt thự song lập', 'Condotel']);
  });

  it('dự án không có chữ cũ chưa khớp: không có cảnh báo', () => {
    setup(project({ propertyTypeCodes: ['APT'], unmappedPropertyTypes: [] }));
    expect(screen.queryByTestId('project-unmapped-property-types')).toBeNull();
  });

  it('chưa đụng ô Loại hình thì PATCH KHÔNG gửi propertyTypeCodes (backend sẽ xóa chữ cũ nếu nhận mảng này)', async () => {
    const user = userEvent.setup();
    setup(withUnmapped());
    await user.type(nameInput(), ' mới');
    submitEdit();
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledTimes(1));
    const body = api.updateProject.mock.calls[0][1];
    expect(body).not.toHaveProperty('propertyTypeCodes');
    expect(body).not.toHaveProperty('propertyTypes');
  });

  it('đã chọn lại loại hình thì PATCH gửi propertyTypeCodes (thay toàn bộ, xóa chữ cũ ở backend)', async () => {
    const user = userEvent.setup();
    setup(withUnmapped());
    await user.click(requireChip('Nhà phố'));
    submitEdit();
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledTimes(1));
    expect(api.updateProject.mock.calls[0][1].propertyTypeCodes).toEqual(['APT', 'TOWN']);
  });
});

describe('Khu vực dùng areaCode (FR-40)', () => {
  it('chọn khu vực: body gửi areaCode (mã) và không gửi areaId', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(nameInput(), 'Sky');
    await user.selectOptions(screen.getByLabelText('Khu vực'), 'HA_NOI');
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    const body = api.createProject.mock.calls[0][0];
    expect(body.areaCode).toBe('HA_NOI');
    expect(body).not.toHaveProperty('areaId');
  });

  it('Sửa dự án có khu vực: ô Khu vực chọn đúng theo mã', () => {
    setup(project({ areaId: 'HA_NOI' }));
    expect((screen.getByLabelText('Khu vực') as HTMLSelectElement).value).toBe('HA_NOI');
  });
});

describe('Mã dự án chỉ đọc khi Sửa (Q1)', () => {
  it('Sửa: ô Mã chỉ đọc, hiện gợi ý không đổi được, PATCH không gửi code', async () => {
    const user = userEvent.setup();
    setup(project());
    expect(codeInput()).toHaveAttribute('readonly');
    expect(codeInput().value).toBe('QTerra');
    expect(screen.getByText('Mã dự án không đổi được sau khi tạo.')).toBeInTheDocument();
    await user.type(codeInput(), 'zzz');
    expect(codeInput().value).toBe('QTerra');
    await user.type(nameInput(), ' mới');
    submitEdit();
    await waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    expect(api.updateProject.mock.calls[0][1]).not.toHaveProperty('code');
  });

  it('Thêm: ô Mã sửa được và POST có gửi code', async () => {
    const user = userEvent.setup();
    setup();
    expect(codeInput()).not.toHaveAttribute('readonly');
    await user.type(nameInput(), 'Sky');
    await user.click(screen.getByRole('button', { name: 'Thêm dự án' }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalled());
    expect(api.createProject.mock.calls[0][0].code).toBe('SKY');
  });
});

describe('Đổi tên lựa chọn không làm hỏng dự án (FR-46)', () => {
  const saved = () => project({ propertyTypeCodes: ['APT'], propertyTypes: ['Căn hộ'] });

  it('đổi nhãn "Căn hộ" -> "Chung cư": form hiện nhãn mới, vẫn chọn đúng mã APT và lưu không đổi mã', async () => {
    const first = setup(saved());
    expect(requireChip('Căn hộ').checked).toBe(true);
    first.unmount();

    state.personaFields = [propertyTypeField(OPTIONS.map((option) => (option.value === 'APT' ? { ...option, label: 'Chung cư' } : option)))];
    const user = userEvent.setup();
    setup(saved());
    expect(chip('Căn hộ')).toBeNull();
    expect(requireChip('Chung cư').checked).toBe(true);

    // Đụng tới ô loại hình (bỏ rồi chọn lại) -> gửi MÃ, không phải nhãn mới/cũ.
    await user.click(requireChip('Chung cư'));
    await user.click(requireChip('Chung cư'));
    submitEdit();
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledTimes(1));
    expect(api.updateProject.mock.calls[0][1].propertyTypeCodes).toEqual(['APT']);
  });

  it('mã đang dùng không còn trong danh mục: hiện bằng chính mã (không âm thầm mất) và giữ khi lưu', async () => {
    const user = userEvent.setup();
    setup(project({ propertyTypeCodes: ['GONE'], propertyTypes: ['GONE'] }));
    expect(requireChip('GONE (đã tắt)').checked).toBe(true);
    await user.click(requireChip('Căn hộ'));
    submitEdit();
    await waitFor(() => expect(api.updateProject).toHaveBeenCalled());
    expect(api.updateProject.mock.calls[0][1].propertyTypeCodes).toEqual(['GONE', 'APT']);
  });
});
