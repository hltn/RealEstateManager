import { describe, expect, it } from 'vitest';
import { SEED_CATALOGS } from '@crm/data/seedCatalogs';
import type { CustomerStatusItem, Project } from '@crm/types/crm';
import {
  createEmptyCatalogItem,
  createEmptyUser,
  deriveDisplayName,
  getNextOrder,
  normalizeCatalogItem,
  normalizeUser,
  sortCatalogItems,
} from './settingsForms';

describe('settingsForms', () => {
  it('thứ tự kế tiếp = lớn nhất + 1; danh mục rỗng -> 1; dự án (không có order) -> 1', () => {
    expect(getNextOrder(SEED_CATALOGS.statuses)).toBe(Math.max(...SEED_CATALOGS.statuses.map((status) => status.order)) + 1);
    expect(getNextOrder([])).toBe(1);
    expect(getNextOrder(SEED_CATALOGS.projects)).toBe(1);
  });

  it('mục ẩn xếp cuối, còn lại theo order', () => {
    const items = [
      { id: 'a', label: 'A', order: 2, isActive: true },
      { id: 'b', label: 'B', order: 1, isActive: false },
      { id: 'c', label: 'C', order: 3, isActive: true },
    ];
    expect(sortCatalogItems(items).map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it('tình trạng mới: không hệ thống, không mặc định; code sinh từ tên khi lưu', () => {
    const draft = createEmptyCatalogItem('statuses', SEED_CATALOGS.statuses, 'st-x') as CustomerStatusItem;
    expect(draft).toMatchObject({ isSystem: false, isDefault: false, isActive: true, listGroup: 'CARING' });
    const saved = normalizeCatalogItem('statuses', { ...draft, label: '  Đã đặt cọc ' }) as CustomerStatusItem;
    expect(saved).toMatchObject({ label: 'Đã đặt cọc', code: 'DA_DAT_COC' });
  });

  it('giữ nguyên code của tình trạng hệ thống khi đổi tên', () => {
    const system = SEED_CATALOGS.statuses[0];
    expect((normalizeCatalogItem('statuses', { ...system, label: 'Mới' }) as CustomerStatusItem).code).toBe(system.code);
  });

  it('dự án: tên đầy đủ mặc định = tên ngắn, mã viết hoa', () => {
    const draft = createEmptyCatalogItem('projects', SEED_CATALOGS.projects, 'p-x') as Project;
    const saved = normalizeCatalogItem('projects', { ...draft, name: ' Sky Park ', code: 'skp ' }) as Project;
    expect(saved).toMatchObject({ name: 'Sky Park', fullName: 'Sky Park', code: 'SKP' });
  });

  it('người dùng: tên hiển thị suy từ họ tên; Quản trị bỏ nhóm', () => {
    expect(deriveDisplayName('  Trần   Mỹ Hạnh ')).toBe('Hạnh');
    const user = normalizeUser({ ...createEmptyUser('u-x', 'team-1'), fullName: ' Lê  Văn  An ', role: 'ADMIN' });
    expect(user).toMatchObject({ fullName: 'Lê Văn An', displayName: 'An', teamId: null });
  });
});
