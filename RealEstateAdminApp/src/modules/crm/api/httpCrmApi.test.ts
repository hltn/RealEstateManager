import { beforeEach, describe, expect, it, vi } from 'vitest';

const patchCustomer = vi.fn();
const patchPersona = vi.fn();
const putNationalIdValue = vi.fn();
vi.mock('./http/customerApi', () => ({
  patchCustomer: (...args: unknown[]) => patchCustomer(...args),
  patchPersona: (...args: unknown[]) => patchPersona(...args),
  putNationalIdValue: (...args: unknown[]) => putNationalIdValue(...args),
}));

import { CrmApiException } from './http/crmErrors';
import { createHttpCrmApi } from './httpCrmApi';

const invalidate = vi.fn();
const setup = () =>
  createHttpCrmApi({ invalidate, getContext: () => ({ actor: { userId: 'u1', role: 'ADMIN' as const } }), getPersonaFields: () => new Map() });

beforeEach(() => {
  patchCustomer.mockReset();
  patchPersona.mockReset();
  putNationalIdValue.mockReset();
  invalidate.mockReset();
});

describe('saveCustomerProfile: hồ sơ -> chân dung -> CCCD, chuyền version đúng', () => {
  it('persona dùng version mới của hồ sơ sau khi PATCH hồ sơ; CCCD gọi cuối cùng; làm mới dữ liệu 1 lần', async () => {
    patchCustomer.mockResolvedValue({ version: 5 });
    patchPersona.mockResolvedValue({ completeness: 40, version: 6 });
    putNationalIdValue.mockResolvedValue({ hasNationalId: true, nationalIdMasked: '••••1234' });
    const api = setup();
    const result = await api.saveCustomerProfile('c1', {
      version: 4,
      profile: { fullName: 'An' },
      personaValues: [{ fieldKey: 'occupation', source: 'STAFF_OBSERVED', value: { valueText: 'Kế toán' } }],
      nationalId: ' 012345678901 ',
    });
    expect(result).toEqual({ ok: true, data: { version: 6 } });
    expect(patchCustomer).toHaveBeenCalledWith('c1', { fullName: 'An', version: 4 }, expect.anything());
    expect(patchPersona.mock.calls[0][1]).toBe(5);
    expect(putNationalIdValue).toHaveBeenCalledWith('c1', '012345678901');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('không có hồ sơ đổi: persona dùng version gốc; không có persona/CCCD thì không gọi', async () => {
    patchPersona.mockResolvedValue({ completeness: 1, version: 8 });
    const api = setup();
    await api.saveCustomerProfile('c1', { version: 7, personaValues: [{ fieldKey: 'k', source: 'CUSTOMER_SHARED', value: null }] });
    expect(patchCustomer).not.toHaveBeenCalled();
    expect(patchPersona.mock.calls[0][1]).toBe(7);
    expect(putNationalIdValue).not.toHaveBeenCalled();
  });

  it('dừng ở bước lỗi đầu tiên (409 VERSION_CONFLICT) và trả lỗi tiếng Việt, và VẪN làm mới dữ liệu (lấy version mới, tránh kẹt 409)', async () => {
    patchCustomer.mockRejectedValue(new CrmApiException({ statusCode: 409, errorCode: 'VERSION_CONFLICT', message: 'Hồ sơ đã bị người khác sửa', details: { currentVersion: 9 } }));
    const api = setup();
    const result = await api.saveCustomerProfile('c1', { version: 4, profile: { fullName: 'An' }, nationalId: '012345678901' });
    expect(result).toMatchObject({ ok: false, error: { errorCode: 'VERSION_CONFLICT', details: { currentVersion: 9 } } });
    expect(patchPersona).not.toHaveBeenCalled();
    expect(putNationalIdValue).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
