import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const patch = vi.fn();
const del = vi.fn();
const list = vi.fn();
vi.mock('./http/crmHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http/crmHttp')>()),
  crmHttp: { raw: vi.fn(), get: vi.fn(), list: (...args: unknown[]) => list(...args), post: vi.fn(), patch: (...args: unknown[]) => patch(...args), del: (...args: unknown[]) => del(...args) },
}));

import { crmKeys, invalidateCrm } from './hooks';
import { CrmApiException } from './http/crmErrors';
import { fetchAdminTags } from './http/adminApi';
import { createHttpCrmApi } from './httpCrmApi';

const invalidate = vi.fn();
const setup = () => createHttpCrmApi({ invalidate, getPersonaFields: () => new Map() });
const tagDto = { id: 't1', label: 'Golf', category: 'INTEREST', usageCount: 4, color: 'brand' };

beforeEach(() => {
  patch.mockReset().mockResolvedValue(tagDto);
  del.mockReset().mockResolvedValue(undefined);
  list.mockReset();
  invalidate.mockReset();
});

describe('thẻ ở màn quản trị (FR-42)', () => {
  it('đọc danh sách: ánh xạ label -> name, giữ usageCount và color (màu thiếu -> null)', async () => {
    list.mockResolvedValue({ data: [tagDto, { id: 't2', label: 'Bác sĩ', category: 'OCCUPATION', usageCount: 0 }], meta: { total: 2, page: 1, limit: 100, totalPages: 1 } });
    await expect(fetchAdminTags()).resolves.toEqual([
      { id: 't1', name: 'Golf', category: 'INTEREST', usageCount: 4, color: 'brand' },
      { id: 't2', name: 'Bác sĩ', category: 'OCCUPATION', usageCount: 0, color: null },
    ]);
    expect(list).toHaveBeenCalledWith('/crm/tags', expect.objectContaining({ params: expect.objectContaining({ sort: 'name' }) }));
  });

  it('đổi tên/nhóm/màu: PATCH /crm/tags/:id chỉ với field đổi (color null = bỏ màu) rồi làm mới danh mục', async () => {
    const result = await setup().updateTag('t1', { name: 'Chơi golf', color: null });
    expect(result.ok).toBe(true);
    expect(patch).toHaveBeenCalledWith('/crm/tags/t1', { name: 'Chơi golf', color: null });
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });

  it('gộp: PATCH chỉ với mergeIntoId (backend cấm kèm field khác), trả thẻ đích', async () => {
    patch.mockResolvedValue({ ...tagDto, id: 't9', label: 'Gôn' });
    const result = await setup().mergeTag('t1', 't9');
    expect(patch).toHaveBeenCalledWith('/crm/tags/t1', { mergeIntoId: 't9' });
    expect(result).toMatchObject({ ok: true, data: { id: 't9', name: 'Gôn' } });
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });

  it('xóa mềm: DELETE /crm/tags/:id rồi làm mới danh mục', async () => {
    const result = await setup().deleteTag('t1');
    expect(result.ok).toBe(true);
    expect(del).toHaveBeenCalledWith('/crm/tags/t1');
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });

  it('trùng tên (409): trả lỗi tiếng Việt của máy chủ, vẫn làm mới', async () => {
    patch.mockRejectedValue(new CrmApiException({ statusCode: 409, errorCode: 'CATALOG_DUPLICATED', message: 'Thẻ "Golf" đã tồn tại.' }));
    const result = await setup().updateTag('t1', { name: 'Golf' });
    expect(result).toMatchObject({ ok: false, error: { errorCode: 'CATALOG_DUPLICATED', message: 'Thẻ "Golf" đã tồn tại.' } });
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });

  it('làm mới danh mục kéo theo khóa `tags` của bộ lọc/gắn hàng loạt/form chân dung và danh sách quản trị', async () => {
    const client = new QueryClient();
    client.setQueryData([...crmKeys.catalogs, 'tags'], []);
    client.setQueryData([...crmKeys.catalogs, 'admin-tags'], []);
    await invalidateCrm(client, { shouldIncludeCatalogs: true });
    expect(client.getQueryState([...crmKeys.catalogs, 'tags'])?.isInvalidated).toBe(true);
    expect(client.getQueryState([...crmKeys.catalogs, 'admin-tags'])?.isInvalidated).toBe(true);
  });
});
