import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const patch = vi.fn();
const put = vi.fn();
const list = vi.fn();
vi.mock('./http/crmHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http/crmHttp')>()),
  crmHttp: {
    raw: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
    list: (...args: unknown[]) => list(...args),
    patch: (...args: unknown[]) => patch(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

import { crmKeys, invalidateCrm } from './hooks';
import { CrmApiException } from './http/crmErrors';
import { fetchAdminPersonaFields } from './http/adminApi';
import { createHttpCrmApi } from './httpCrmApi';

const invalidate = vi.fn();
const setup = () => createHttpCrmApi({ invalidate, getContext: () => ({ actor: { userId: 'u1', role: 'ADMIN' as const } }), getPersonaFields: () => new Map() });

const fieldDto = {
  id: 'f1',
  key: 'property_type',
  label: 'Loại hình',
  helpText: null,
  placeholder: null,
  groupCode: 'REAL_ESTATE',
  type: 'MULTI_SELECT',
  options: [
    { value: 'APT', label: 'Căn hộ', isActive: true },
    { value: 'OLD', label: 'Loại cũ', isActive: false },
  ],
  order: 3,
  weight: 1,
  suggestPriority: 1,
  isFilterable: true,
  isOccasion: false,
  occasionLabel: null,
  linkedCriterion: null,
  isSensitive: false,
  isSystem: true,
  isActive: true,
};
const mapped = {
  id: 'f1',
  key: 'property_type',
  label: 'Loại hình',
  groupCode: 'REAL_ESTATE',
  type: 'MULTI_SELECT',
  options: [
    { value: 'APT', label: 'Căn hộ', isActive: true },
    { value: 'OLD', label: 'Loại cũ', isActive: false },
  ],
  order: 3,
  isSystem: true,
  isActive: true,
};

beforeEach(() => {
  patch.mockReset().mockResolvedValue(fieldDto);
  put.mockReset().mockResolvedValue([fieldDto]);
  list.mockReset();
  invalidate.mockReset();
});

describe('trường chân dung ở màn quản trị (FR-41, T-63)', () => {
  it('đọc danh sách: limit 100 (mức tối đa của BE), giữ cả lựa chọn đã tắt, id, order, isSystem', async () => {
    list.mockResolvedValue({ data: [fieldDto], meta: { total: 1, page: 1, limit: 100, totalPages: 1 } });
    await expect(fetchAdminPersonaFields()).resolves.toEqual([mapped]);
    expect(list).toHaveBeenCalledWith('/crm/persona-fields', expect.objectContaining({ params: expect.objectContaining({ limit: 100 }) }));
  });

  it('sửa: PATCH /crm/persona-fields/:id chỉ với phần đổi, trả trường đã ánh xạ và làm mới danh mục', async () => {
    const body = { label: 'Loại BĐS', options: [{ value: 'APT', label: 'Căn hộ', isActive: true }] };
    const result = await setup().updatePersonaField('f1', body);
    expect(patch).toHaveBeenCalledWith('/crm/persona-fields/f1', body);
    expect(result).toMatchObject({ ok: true, data: mapped });
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });

  it('id có ký tự đặc biệt được mã hóa trong URL', async () => {
    await setup().updatePersonaField('a/b', { isActive: false });
    expect(patch).toHaveBeenCalledWith('/crm/persona-fields/a%2Fb', { isActive: false });
  });

  it('sắp xếp: PUT /crm/persona-fields/order với { items }, trả toàn bộ trường và làm mới danh mục', async () => {
    const items = [{ id: 'f1', order: 4 }, { id: 'f2', order: 3 }];
    const result = await setup().reorderPersonaFields(items);
    expect(put).toHaveBeenCalledWith('/crm/persona-fields/order', { items });
    expect(result).toMatchObject({ ok: true, data: [mapped] });
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });

  it('lỗi 409 giữ nguyên errorCode/details để màn hình tự chọn lời báo', async () => {
    patch.mockRejectedValue(new CrmApiException({ statusCode: 409, errorCode: 'PERSONA_FIELD_TYPE_LOCKED', message: 'x', details: { valueCount: 5 } }));
    const result = await setup().updatePersonaField('f1', { label: 'A' });
    expect(result).toMatchObject({ ok: false, error: { statusCode: 409, errorCode: 'PERSONA_FIELD_TYPE_LOCKED', details: { valueCount: 5 } } });
  });

  it('làm mới danh mục kéo theo khóa `persona-fields` của form/bộ lọc và danh sách quản trị', async () => {
    const client = new QueryClient();
    client.setQueryData([...crmKeys.catalogs, 'persona-fields'], []);
    client.setQueryData([...crmKeys.catalogs, 'admin-persona-fields'], []);
    await invalidateCrm(client, { shouldIncludeCatalogs: true });
    expect(client.getQueryState([...crmKeys.catalogs, 'persona-fields'])?.isInvalidated).toBe(true);
    expect(client.getQueryState([...crmKeys.catalogs, 'admin-persona-fields'])?.isInvalidated).toBe(true);
  });
});
