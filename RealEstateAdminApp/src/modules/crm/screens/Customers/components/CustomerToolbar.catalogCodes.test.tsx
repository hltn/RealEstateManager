/**
 * FR-40 (tiêu chí T-15): danh mục do MAPPER trả về (response backend có cả `id` ObjectId lẫn `code`) đổ vào ô lọc
 * thì `<option value>` phải là `code`. Nếu mapper quay về dùng id ObjectId thì các test này đỏ.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { toAreaList, toProject } from '../../../api/http/catalogMappers';
import type { AreaDto, ProjectDto } from '../../../api/http/dto';
import { listProjectFilterOptions } from '@crm/lib/projectRules';
import { DEFAULT_FILTERS } from '@crm/store';
import type { CrmCatalogs } from '@crm/types/crm';
import { CustomerToolbar } from './CustomerToolbar';

const ID = (n: number) => `66f1a2b3c4d5e6f7081900${String(n).padStart(2, '0')}`;

const areaDto = (n: number, code: string, name: string): AreaDto => ({
  id: ID(n), code, label: name, name, type: 'PROVINCE', parentId: null, path: [], adminCode: null, isLegacy: false, order: n, isActive: true,
});
const projectDto = (n: number, code: string, name: string): ProjectDto => ({
  id: ID(n), name, code, developer: null, location: null, area: null, propertyTypes: [], priceFrom: null, priceTo: null, status: 'SELLING', isActive: true, customerCount: 0, deletedAt: null,
});

const catalogs: CrmCatalogs = {
  statuses: [],
  leadSources: [],
  areas: toAreaList([areaDto(10, 'HA_NOI', 'Hà Nội'), areaDto(11, 'TP_HO_CHI_MINH', 'TP. Hồ Chí Minh')]),
  projects: [projectDto(20, 'qterra', "Q'Terra"), projectDto(21, 'VHOP', 'Vinhomes Ocean Park')].map(toProject),
  tags: [],
  contactResults: [],
};

vi.mock('@crm/api', async () => {
  const actual = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...actual,
    useCatalogs: () => ({ catalogs, users: [] }),
    useAssigneeFilterOptions: () => [],
    useProjectFilterOptions: () => listProjectFilterOptions(catalogs.projects, new Set()),
  };
});
vi.mock('@crm/store', async () => {
  const actual = await vi.importActual<typeof import('@crm/store')>('@crm/store');
  return { ...actual, useCrmActions: () => ({ openAdvancedFilter: vi.fn() }) };
});

type ToolbarScreen = Parameters<typeof CustomerToolbar>[0]['screen'];
const screenOf = (filters = DEFAULT_FILTERS): ToolbarScreen => ({ filters, sort: 'lastUpdatedAt', setSort: vi.fn(), updateFilters: vi.fn() }) as unknown as ToolbarScreen;
const optionValues = (select: HTMLElement): string[] => within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value);

describe('bộ lọc khách dùng danh mục từ mapper (FR-40)', () => {
  it('FR-40: ô lọc nhanh Dự án và Khu vực: <option value> là code (dự án là mã chuẩn hóa HOA)', () => {
    render(<CustomerToolbar screen={screenOf()} />);
    expect(optionValues(screen.getByLabelText('Dự án'))).toEqual(['all', 'QTERRA', 'VHOP']);
    expect(optionValues(screen.getByLabelText('Khu vực'))).toEqual(['all', 'HA_NOI', 'TP_HO_CHI_MINH']);
  });

  it('FR-40: đối chứng: không có <option value> nào là ObjectId', () => {
    render(<CustomerToolbar screen={screenOf()} />);
    const values = screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value);
    expect(values.filter((value) => /^[0-9a-f]{24}$/.test(value))).toEqual([]);
  });

  it('FR-40: bộ lọc đang lưu là code thì ô Khu vực hiển thị đúng mục đó', () => {
    render(<CustomerToolbar screen={screenOf({ ...DEFAULT_FILTERS, areaIds: ['HA_NOI'] })} />);
    const select = screen.getByLabelText('Khu vực') as HTMLSelectElement;
    expect(select.value).toBe('HA_NOI');
    expect(select.selectedOptions[0].textContent).toBe('Hà Nội');
  });
});
