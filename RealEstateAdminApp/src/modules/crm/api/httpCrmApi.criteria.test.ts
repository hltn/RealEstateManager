/** PT-023: lỗi 409 khi sửa tiêu chí vẫn làm mới dữ liệu (để lấy version mới cho lần tick kế tiếp). */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const patchCriteria = vi.fn();
vi.mock('./http/customerApi', () => ({ patchCriteria: (...args: unknown[]) => patchCriteria(...args) }));

import { CrmApiException } from './http/crmErrors';
import { createHttpCrmApi } from './httpCrmApi';

const invalidate = vi.fn();
const setup = () => createHttpCrmApi({ invalidate, getPersonaFields: () => new Map() });

beforeEach(() => {
  patchCriteria.mockReset();
  invalidate.mockReset();
});

describe('updateCustomerCriteria (PT-023)', () => {
  it('thành công (kể cả khi tình trạng tự đổi): làm mới dữ liệu và trả autoStatusChange cho UI', async () => {
    const autoStatusChange = { from: null, to: { id: 's', code: 'NET', label: 'Net', listGroup: 'INTERESTED', tone: 'success' } };
    patchCriteria.mockResolvedValue({ progress: 75, version: 9, lastUpdatedAt: 't', autoStatusChange });
    const result = await setup().updateCustomerCriteria('c1', { version: 7, criteria: { finance: { isDone: true } } });
    expect(result).toMatchObject({ ok: true, data: { version: 9, autoStatusChange } });
    expect(invalidate).toHaveBeenCalled();
  });

  it('409 VERSION_CONFLICT: trả lỗi và vẫn làm mới dữ liệu', async () => {
    patchCriteria.mockRejectedValue(new CrmApiException({ statusCode: 409, errorCode: 'VERSION_CONFLICT', message: 'Hồ sơ đã bị sửa', details: { currentVersion: 9 } }));
    const result = await setup().updateCustomerCriteria('c1', { version: 1, criteria: { finance: { isDone: true } } });
    expect(result).toMatchObject({ ok: false, error: { errorCode: 'VERSION_CONFLICT' } });
    expect(invalidate).toHaveBeenCalled();
  });
});
