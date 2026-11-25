/** Tab Dự án của Cài đặt (T-67, FR-46): dự án còn chữ loại hình cũ chưa khớp được đánh dấu để Quản trị chọn lại. */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@crm/types/crm';

const state = { projects: [] as Project[] };

vi.mock('@crm/api', () => ({
  useCatalogs: () => ({ catalogs: { projects: state.projects } }),
  useProjectsWithCounts: () => ({ data: new Map<string, number>() }),
  useCrmApi: () => ({ updateProject: vi.fn() }),
}));
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast: vi.fn() }) }));
vi.mock('../../Projects/ProjectFormDialog', () => ({ ProjectFormDialog: () => null }));

import { ProjectsCatalogSection } from './ProjectsCatalogSection';

const project = (overrides: Partial<Project>): Project => ({
  id: 'A',
  code: 'A',
  name: 'Dự án A',
  fullName: 'Dự án A',
  developer: '',
  location: '',
  areaId: null,
  propertyTypes: [],
  priceFrom: null,
  priceTo: null,
  priceUnit: 'TOTAL',
  status: null,
  segment: '',
  isActive: true,
  deletedAt: null,
  ...overrides,
});

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('ProjectsCatalogSection: loại hình cũ chưa khớp (FR-46)', () => {
  it('chỉ dự án có unmappedPropertyTypes mới có nhãn cảnh báo (kèm danh sách chữ cũ ở title)', () => {
    state.projects = [
      project({ id: 'A', name: 'Dự án A', unmappedPropertyTypes: ['Condotel', 'Officetel'] }),
      project({ id: 'B', name: 'Dự án B', code: 'B', unmappedPropertyTypes: [] }),
      project({ id: 'C', name: 'Dự án C', code: 'C' }),
    ];
    render(<ProjectsCatalogSection />);
    const badge = within(rowOf('Dự án A')).getByText('Loại hình cũ chưa khớp');
    expect(badge).toHaveAttribute('title', 'Condotel, Officetel');
    expect(within(rowOf('Dự án B')).queryByText('Loại hình cũ chưa khớp')).toBeNull();
    expect(within(rowOf('Dự án C')).queryByText('Loại hình cũ chưa khớp')).toBeNull();
  });
});
