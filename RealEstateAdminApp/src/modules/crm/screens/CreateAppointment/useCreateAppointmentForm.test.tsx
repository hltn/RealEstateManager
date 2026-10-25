import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CUSTOMER_PICKER_LIMIT, useCreateAppointmentForm } from './useCreateAppointmentForm';

const useCustomerList = vi.fn();
const createAppointment = vi.fn();

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ createAppointment }),
    useCustomerDetail: () => ({ data: null }),
    useCustomerList: (query: unknown) => useCustomerList(query),
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  useCustomerList.mockReset();
  useCustomerList.mockReturnValue({ data: { data: [], meta: { total: 120, page: 1, limit: 50, totalPages: 3 } } });
});
afterEach(() => vi.useRealTimers());

const setup = () => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <CrmProvider store={store}>{children}</CrmProvider>
    </MemoryRouter>
  );
  return renderHook(() => useCreateAppointmentForm(), { wrapper });
};

describe('chọn khách cho lịch hẹn: tìm qua API + debounce, mỗi lần một trang', () => {
  it('mặc định không có từ khóa, giới hạn 50 khách/lần; từ khóa chỉ gửi sau khi hết debounce', () => {
    const { result } = setup();
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ q: '', limit: CUSTOMER_PICKER_LIMIT, listGroup: 'ALL' }));
    expect(result.current.customerTotal).toBe(120);

    act(() => result.current.setCustomerSearch('zeta hiem'));
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ q: '' })); // chưa hết debounce
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(useCustomerList).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'zeta hiem' }));
  });
});
