import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn();
const patch = vi.fn();
vi.mock('./http/crmHttp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http/crmHttp')>()),
  crmHttp: { raw: vi.fn(), get: vi.fn(), list: vi.fn(), post: (...args: unknown[]) => post(...args), patch: (...args: unknown[]) => patch(...args), del: vi.fn() },
}));

import { CrmApiException } from './http/crmErrors';
import { rememberCatalogId } from './http/catalogIds';
import { createHttpCrmApi } from './httpCrmApi';

const invalidate = vi.fn();
const setup = () => createHttpCrmApi({ invalidate, getPersonaFields: () => new Map() });

beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  invalidate.mockReset();
  rememberCatalogId('contactResults', '65f000000000000000000001', 'PRICE_QUOTE');
});

describe('ghi Kết quả liên hệ làm mới danh mục để form Nhật ký thấy ngay (FR-39)', () => {
  it('FR-39: thêm gọi POST /crm/contact-results rồi làm mới danh mục', async () => {
    const body = { code: 'HEN_XEM_NHA', label: 'Hẹn xem nhà', order: 4, suggestedFollowUpDays: 3, suggestionText: '' };
    const result = await setup().createCatalogItem('contact-results', body);
    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledWith('/crm/contact-results', body);
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });

  it('FR-39: sửa/ẩn đổi code của UI sang id thật trong URL PATCH rồi làm mới danh mục', async () => {
    const body = { label: 'Đã báo giá', order: 1, isActive: false, suggestedFollowUpDays: null, suggestionText: '' };
    const result = await setup().updateCatalogItem('contact-results', 'PRICE_QUOTE', body);
    expect(result.ok).toBe(true);
    expect(patch).toHaveBeenCalledWith('/crm/contact-results/65f000000000000000000001', body);
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });

  it('FR-39: máy chủ báo lỗi -> trả lỗi tiếng Việt của máy chủ và vẫn làm mới danh mục', async () => {
    post.mockRejectedValue(new CrmApiException({ statusCode: 409, errorCode: 'CATALOG_DUPLICATED', message: 'Mã hoặc tên đã tồn tại.' }));
    const result = await setup().createCatalogItem('contact-results', { code: 'X', label: 'X' });
    expect(result).toMatchObject({ ok: false, error: { errorCode: 'CATALOG_DUPLICATED', message: 'Mã hoặc tên đã tồn tại.' } });
    expect(invalidate).toHaveBeenCalledWith({ shouldIncludeCatalogs: true });
  });
});
