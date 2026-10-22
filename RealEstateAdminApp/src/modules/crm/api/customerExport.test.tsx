/** Xuất CSV: quyền kiểm ở lớp API/hook (không chỉ ẩn nút), mỗi lần xuất ghi audit CUSTOMER_EXPORTED, SĐT trong CSV giữ đầy đủ. */
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { createTestHarness, FIXED_NOW } from '@crm/test/fixtures';
import { useCustomerExport } from './hooks';

describe('createCustomerExport (lớp dữ liệu)', () => {
  it.each(['thao', 'tung'])('%s (nhân viên) bị từ chối 403, không có file và không ghi audit', (userId) => {
    const harness = createTestHarness(userId);
    expect(harness.api.createCustomerExport({ listGroup: 'ALL', limit: 100 })).toMatchObject({ ok: false, error: { statusCode: 403, errorCode: 'INSUFFICIENT_ROLE' } });
    expect(harness.getState().auditLogs).toHaveLength(0);
  });

  it.each(['hanh', 'admin'])('%s xuất được; CSV giữ SĐT đầy đủ; ghi đúng 1 audit CUSTOMER_EXPORTED có số dòng', (userId) => {
    const harness = createTestHarness(userId);
    const result = harness.api.createCustomerExport({ listGroup: 'ALL', limit: 100 });
    if (!result.ok) throw new Error('setup');
    expect(result.data.rowCount).toBeGreaterThan(0);
    expect(result.data.content).toContain('0912 345 678');
    const logs = harness.getState().auditLogs;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: 'CUSTOMER_EXPORTED', entityType: 'CUSTOMER_EXPORT', entityId: null, actorId: userId });
    expect(logs[0].changes).toEqual([
      { field: 'Số khách xuất', from: '', to: String(result.data.rowCount) },
      { field: 'Tệp', from: '', to: result.data.fileName },
    ]);
    harness.api.createCustomerExport({ listGroup: 'ALL', limit: 100 });
    expect(harness.getState().auditLogs.filter((log) => log.action === 'CUSTOMER_EXPORTED')).toHaveLength(2);
  });

  it('quản lý chỉ xuất khách trong phạm vi của mình (không lộ khách nhóm khác)', () => {
    const harness = createTestHarness('hanh');
    const result = harness.api.createCustomerExport({ listGroup: 'ALL', limit: 100 });
    if (!result.ok) throw new Error('setup');
    expect(result.data.content).not.toContain('0988 333 112');
  });
});

describe('useCustomerExport (hook)', () => {
  const setup = (userId: string) => {
    const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), initialSession: { currentUserId: userId }, shouldPersist: false });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <CrmProvider store={store}>{children}</CrmProvider>
      </MemoryRouter>
    );
    return { store, ...renderHook(() => useCustomerExport(), { wrapper }) };
  };

  it('nhân viên: 403 qua hook, store không ghi audit', () => {
    const { store, result } = setup('thao');
    expect(result.current({ listGroup: 'ALL', limit: 100 })).toMatchObject({ ok: false, error: { statusCode: 403 } });
    expect(store.getState().state.auditLogs).toHaveLength(0);
  });

  it('quản lý: có file + ghi audit vào store', () => {
    const { store, result } = setup('hanh');
    const exported = result.current({ listGroup: 'ALL', limit: 100 });
    expect(exported.ok).toBe(true);
    expect(store.getState().state.auditLogs.map((log) => log.action)).toEqual(['CUSTOMER_EXPORTED']);
  });
});
