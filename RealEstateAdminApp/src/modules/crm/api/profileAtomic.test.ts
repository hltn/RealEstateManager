/** Hồi quy C8: lưu hồ sơ + CCCD + chân dung nguyên tử; "Xoá CCCD"; kho CCCD chỉ ghi sau khi hồ sơ được chấp nhận. */
import { beforeEach, describe, expect, it } from 'vitest';
import { resetNationalIdVaultForTest, revealNationalId, seedNationalIds } from '@crm/lib/nationalIdVault';
import { createTestHarness } from '@crm/test/fixtures';

beforeEach(() => {
  resetNationalIdVaultForTest();
  seedNationalIds({ 'CUST-001': '079092001234' });
});

const customerOf = (harness: ReturnType<typeof createTestHarness>, id = 'CUST-001') => harness.getState().customers.find((item) => item.id === id)!;

describe('saveCustomerProfile (atomic)', () => {
  it('lưu thành công = đúng 1 lần tăng version và 1 changeLog dù đổi cả hồ sơ, CCCD, chân dung', () => {
    const harness = createTestHarness('hanh');
    const before = customerOf(harness);
    const logsBefore = harness.getState().changeLogs.length;
    const result = harness.api.saveCustomerProfile('CUST-001', {
      version: before.version,
      profile: { fullName: 'Nguyễn Văn An (đã sửa)' },
      nationalId: '079092009999',
      personaValues: [{ fieldKey: 'occupation', value: { valueText: 'Kỹ sư' }, source: 'CUSTOMER_SHARED' }],
    });
    expect(result.ok).toBe(true);
    expect(customerOf(harness).version).toBe(before.version + 1);
    expect(harness.getState().changeLogs.length).toBe(logsBefore + 1);
    expect(customerOf(harness).nationalIdLast4).toBe('9999');
    expect(revealNationalId('CUST-001')).toBe('079092009999');
  });

  it('chân dung sai khoá -> KHÔNG ghi gì (tên, CCCD, version đều giữ nguyên)', () => {
    const harness = createTestHarness('hanh');
    const before = customerOf(harness);
    const result = harness.api.saveCustomerProfile('CUST-001', {
      version: before.version,
      profile: { fullName: 'Tên mới không được lưu' },
      nationalId: '079092009999',
      personaValues: [{ fieldKey: 'khong_ton_tai', value: null, source: 'CUSTOMER_SHARED' }],
    });
    expect(!result.ok && result.error.errorCode).toBe('PERSONA_VALUE_INVALID');
    const after = customerOf(harness);
    expect(after.version).toBe(before.version);
    expect(after.fullName).toBe(before.fullName);
    expect(after.nationalIdLast4).toBe('1234');
    expect(revealNationalId('CUST-001')).toBe('079092001234');
  });

  it('SĐT trùng khách khác -> không ghi CCCD vào kho', () => {
    const harness = createTestHarness('hanh');
    const result = harness.api.saveCustomerProfile('CUST-001', { profile: { phone: '0988 333 112' }, nationalId: '079092009999' });
    expect(result.ok).toBe(false);
    expect(revealNationalId('CUST-001')).toBe('079092001234');
  });

  it('CCCD sai định dạng -> từ chối cả lượt', () => {
    const harness = createTestHarness('hanh');
    const before = customerOf(harness);
    const result = harness.api.saveCustomerProfile('CUST-001', { profile: { fullName: 'X' }, nationalId: '123' });
    expect(result.ok).toBe(false);
    expect(customerOf(harness).fullName).toBe(before.fullName);
  });
});

describe('deleteNationalId', () => {
  it('xoá khỏi hồ sơ + kho, ghi changeLog; gọi lại là no-op', () => {
    const harness = createTestHarness('hanh');
    const logsBefore = harness.getState().changeLogs.length;
    expect(harness.api.deleteNationalId('CUST-001').ok).toBe(true);
    expect(customerOf(harness)).toMatchObject({ hasNationalId: false, nationalIdLast4: null });
    expect(revealNationalId('CUST-001')).toBeNull();
    const log = harness.getState().changeLogs[0];
    expect(log).toMatchObject({ customerId: 'CUST-001', action: 'NATIONAL_ID_UPDATED' });
    expect(harness.getState().changeLogs.length).toBe(logsBefore + 1);
    expect(harness.api.deleteNationalId('CUST-001').ok).toBe(true);
    expect(harness.getState().changeLogs.length).toBe(logsBefore + 1);
  });

  it('ngoài phạm vi -> 404', () => {
    const harness = createTestHarness('thao');
    const result = harness.api.deleteNationalId('CUST-002');
    expect(!result.ok && result.error.statusCode).toBe(404);
  });
});

describe('createCustomer ghi kho CCCD sau khi tạo', () => {
  it('tạo thất bại (SĐT trùng) -> không để lại CCCD trong kho', () => {
    const harness = createTestHarness('hanh');
    const result = harness.api.createCustomer({ fullName: 'Trùng', phone: '0912345678', nationalId: '012345678901' });
    expect(result.ok).toBe(false);
    expect(harness.getState().customers.every((customer) => revealNationalId(customer.id) !== '012345678901')).toBe(true);
  });
});

describe('Th3 đổi CCCD mà 4 số cuối trùng số cũ', () => {
  it('putNationalId: vẫn tăng version và ghi changeLog', () => {
    const harness = createTestHarness('hanh');
    const before = customerOf(harness);
    const logsBefore = harness.getState().changeLogs.length;
    expect(harness.api.putNationalId('CUST-001', '079099991234').ok).toBe(true); // 4 số cuối vẫn 1234
    expect(customerOf(harness).version).toBe(before.version + 1);
    expect(harness.getState().changeLogs).toHaveLength(logsBefore + 1);
    expect(harness.getState().changeLogs[0].action).toBe('NATIONAL_ID_UPDATED');
    expect(revealNationalId('CUST-001')).toBe('079099991234');
  });

  it('saveCustomerProfile cũng vậy', () => {
    const harness = createTestHarness('hanh');
    const before = customerOf(harness);
    expect(harness.api.saveCustomerProfile('CUST-001', { nationalId: '079088881234' }).ok).toBe(true);
    expect(customerOf(harness).version).toBe(before.version + 1);
    expect(harness.getState().changeLogs[0]).toMatchObject({ customerId: 'CUST-001', action: 'NATIONAL_ID_UPDATED' });
  });

  it('nhập lại đúng số cũ (không đổi gì) là no-op', () => {
    const harness = createTestHarness('hanh');
    const before = customerOf(harness);
    harness.api.putNationalId('CUST-001', '079092001234');
    expect(customerOf(harness).version).toBe(before.version);
  });
});
