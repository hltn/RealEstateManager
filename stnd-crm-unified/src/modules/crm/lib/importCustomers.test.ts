import { describe, expect, it } from 'vitest';
import { SEED_CATALOGS, SEED_USERS } from '@crm/data/seedCatalogs';
import { IMPORT_PRESETS, validateImportRows, type ImportMapping } from './importCustomers';

const mapping: ImportMapping = { fullName: 0, phone: 1, status: -1, source: -1, projects: -1, area: -1, primaryAssignee: -1, notes: -1 };
const context = { catalogs: SEED_CATALOGS, users: SEED_USERS, preset: IMPORT_PRESETS[0] };

describe('validateImportRows: v1.0.5 cho phép trùng SĐT', () => {
  it('cùng một SĐT lặp trong file KHÔNG còn là lỗi', () => {
    const results = validateImportRows(
      [
        ['An', '0912345678'],
        ['Bình', '0912345678'],
      ],
      mapping,
      context,
    );
    expect(results.map((row) => row.errors)).toEqual([[], []]);
    expect(results.every((row) => row.data?.phone === '+84912345678')).toBe(true);
  });

  it('vẫn báo thiếu họ tên và SĐT sai', () => {
    const [missingName, badPhone] = validateImportRows(
      [
        ['', '0912345678'],
        ['An', '12'],
      ],
      mapping,
      context,
    );
    expect(missingName.errors).toContain('Thiếu họ tên');
    expect(missingName.data).toBeNull();
    expect(badPhone.errors.some((message) => message.startsWith('SĐT không hợp lệ'))).toBe(true);
  });
});
