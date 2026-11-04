/** PT-023: toast khi server tự đổi tình trạng theo tiến độ tiêu chí (3/4), dùng chung mobile + desktop. */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { useCustomerDetailActions } from './useCustomerDetailActions';

const updateCustomerCriteria = vi.fn();
const showToast = vi.fn();

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({ updateCustomerCriteria }) };
});
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast }) }));

const status = (code: string, label: string) => ({ id: `s-${code}`, code, label, listGroup: 'INTERESTED' as const, tone: 'success' as const });
const criteria = {
  demand: { isDone: true, description: '' },
  motivation: { isDone: true, description: '' },
  finance: { isDone: false, description: '' },
  timing: { isDone: false, description: '' },
};
const customerOf = (version: number) =>
  ({ id: 'c1', version, status: status('INTERESTED', 'Quan tâm'), criteria, careTeam: [] }) as unknown as Pick<CustomerDetail, 'id' | 'version' | 'status' | 'criteria' | 'careTeam'>;

beforeEach(() => {
  updateCustomerCriteria.mockReset();
  showToast.mockReset();
});

describe('toggleCriterion + tự chuyển tình trạng (PT-023)', () => {
  it('đạt 3/4: toast 6 giây "từ A -> B" kèm lý do đạt 3/4, KHÔNG có nút Hoàn tác', async () => {
    updateCustomerCriteria.mockResolvedValue({
      ok: true,
      data: { progress: 75, version: 9, lastUpdatedAt: 't', autoStatusChange: { from: status('INTERESTED', 'Quan tâm'), to: status('NET', 'Net') } },
    });
    const { result } = renderHook(() => useCustomerDetailActions(customerOf(7)));
    await result.current.toggleCriterion('finance');
    expect(updateCustomerCriteria).toHaveBeenCalledWith('c1', { version: 7, criteria: { finance: { isDone: true } } });
    expect(showToast).toHaveBeenCalledTimes(1);
    const toast = showToast.mock.calls[0][0];
    expect(toast.title).toBe('Đã tự chuyển tình trạng: "Quan tâm" → "Net"');
    expect(toast.message).toBe('Do tiến độ đạt 3/4 tiêu chí.');
    expect(toast.durationMs).toBe(6000);
    expect(toast.action).toBeUndefined();
    expect(toast.type).toBeUndefined();
  });

  it('xuống dưới 3/4: toast lý do "xuống dưới 3/4 tiêu chí"', async () => {
    updateCustomerCriteria.mockResolvedValue({
      ok: true,
      data: { progress: 50, version: 9, lastUpdatedAt: 't', autoStatusChange: { from: status('NET', 'Net'), to: status('INTERESTED', 'Quan tâm') } },
    });
    const { result } = renderHook(() => useCustomerDetailActions(customerOf(7)));
    await result.current.toggleCriterion('demand');
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Đã tự chuyển tình trạng: "Net" → "Quan tâm"', message: 'Do tiến độ xuống dưới 3/4 tiêu chí.', durationMs: 6000 }),
    );
  });

  it('không có autoStatusChange: KHÔNG toast nào (tick thường im lặng như cũ)', async () => {
    updateCustomerCriteria.mockResolvedValue({ ok: true, data: { progress: 50, version: 8, lastUpdatedAt: 't' } });
    const { result } = renderHook(() => useCustomerDetailActions(customerOf(7)));
    await result.current.toggleCriterion('finance');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('lỗi 409: chỉ toast lỗi hướng dẫn, không toast tự đổi tình trạng', async () => {
    updateCustomerCriteria.mockResolvedValue({ ok: false, error: { statusCode: 409, errorCode: 'VERSION_CONFLICT', message: 'Hồ sơ đã bị sửa' } });
    const { result } = renderHook(() => useCustomerDetailActions(customerOf(7)));
    await result.current.toggleCriterion('finance');
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    expect(showToast.mock.calls[0][0].title).not.toContain('Đã tự chuyển');
  });

  it('lần tick kế tiếp dùng version MỚI (sau tự đổi, version +2) lấy từ dữ liệu đã làm mới', async () => {
    updateCustomerCriteria.mockResolvedValue({ ok: true, data: { progress: 75, version: 9, lastUpdatedAt: 't' } });
    const { result, rerender } = renderHook(({ version }) => useCustomerDetailActions(customerOf(version)), { initialProps: { version: 7 } });
    await result.current.toggleCriterion('finance');
    rerender({ version: 9 });
    await result.current.toggleCriterion('timing');
    expect(updateCustomerCriteria).toHaveBeenNthCalledWith(1, 'c1', expect.objectContaining({ version: 7 }));
    expect(updateCustomerCriteria).toHaveBeenNthCalledWith(2, 'c1', expect.objectContaining({ version: 9 }));
  });
});
