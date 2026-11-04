/**
 * QA bổ sung M6: sau lỗi ghi, dữ liệu hiển thị (và `version`) phải được làm mới, nếu không người dùng kẹt 409.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const patchCustomer = vi.fn();
const patchPersona = vi.fn();
const patchStatus = vi.fn();
vi.mock('./http/customerApi', () => ({
  patchCustomer: (...args: unknown[]) => patchCustomer(...args),
  patchPersona: (...args: unknown[]) => patchPersona(...args),
  patchStatus: (...args: unknown[]) => patchStatus(...args),
}));

import { CrmApiException } from './http/crmErrors';
import { createHttpCrmApi } from './httpCrmApi';

const invalidate = vi.fn();
const setup = () =>
  createHttpCrmApi({ invalidate, getContext: () => ({ actor: { userId: 'u1', role: 'ADMIN' as const } }), getPersonaFields: () => new Map() });
const conflict = () => new CrmApiException({ statusCode: 409, errorCode: 'VERSION_CONFLICT', message: 'Hồ sơ đã bị người khác sửa', details: { currentVersion: 9 } });

beforeEach(() => {
  patchCustomer.mockReset();
  patchPersona.mockReset();
  patchStatus.mockReset();
  invalidate.mockReset();
});

describe('làm mới dữ liệu sau lỗi ghi', () => {
  it('409 VERSION_CONFLICT khi đổi tình trạng: phải tải lại dữ liệu để lấy version mới (không kẹt 409 ở các lần bấm sau)', async () => {
    patchStatus.mockRejectedValue(conflict());
    const result = await setup().updateCustomerStatus('c1', { statusId: 's1', version: 1 });
    expect(result).toMatchObject({ ok: false, error: { errorCode: 'VERSION_CONFLICT' } });
    expect(invalidate).toHaveBeenCalled();
  });

  it('lưu hồ sơ thành công nhưng chân dung lỗi (400): hồ sơ ĐÃ đổi trên server nên phải làm mới, nếu không lần lưu lại sẽ 409 với chính thay đổi của mình', async () => {
    patchCustomer.mockResolvedValue({ version: 5 });
    patchPersona.mockRejectedValue(new CrmApiException({ statusCode: 400, errorCode: 'PERSONA_VALUE_INVALID', message: 'Giá trị không hợp lệ' }));
    const result = await setup().saveCustomerProfile('c1', {
      version: 4,
      profile: { fullName: 'An' },
      personaValues: [{ fieldKey: 'k', source: 'STAFF_OBSERVED', value: { valueText: 'x' } }],
    });
    expect(result.ok).toBe(false);
    expect(invalidate).toHaveBeenCalled();
  });
});
