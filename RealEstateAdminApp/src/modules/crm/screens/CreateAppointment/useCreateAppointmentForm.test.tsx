import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import type { Customer } from '@crm/types/crm';
import { CUSTOMER_PICKER_LIMIT, useCreateAppointmentForm } from './useCreateAppointmentForm';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** 150 khách thêm vào để khách "Zeta Hiếm Gặp" nằm ngoài 100 khách đầu tiên theo tên. */
const setup = () => {
  const data = createSeedDataState(FIXED_NOW);
  const template = data.customers[0];
  const bulk: Customer[] = Array.from({ length: 150 }, (_, index) => ({
    ...template,
    id: `BULK-${index}`,
    code: `#B${index}`,
    fullName: index === 149 ? 'Zeta Hiếm Gặp' : `Aaa Khách ${String(index).padStart(3, '0')}`,
    phone: `+8490${String(1000000 + index)}`,
    searchText: index === 149 ? 'zeta hiem gap 0901001149' : `aaa khach ${index}`,
  }));
  const store = createCrmStore({ initialData: { ...data, customers: [...data.customers, ...bulk] }, initialSession: { currentUserId: 'admin' }, shouldPersist: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <CrmProvider store={store}>{children}</CrmProvider>
    </MemoryRouter>
  );
  return renderHook(() => useCreateAppointmentForm(), { wrapper });
};

describe('TB2 chọn khách cho lịch hẹn: tìm qua lớp dữ liệu + debounce, không giới hạn 100 khách đầu', () => {
  it('mặc định chỉ một trang; khách ngoài trang đầu tìm được bằng từ khoá sau debounce', () => {
    const { result } = setup();
    expect(result.current.customers).toHaveLength(CUSTOMER_PICKER_LIMIT);
    expect(result.current.customerTotal).toBeGreaterThan(CUSTOMER_PICKER_LIMIT);
    expect(result.current.customers.some((customer) => customer.fullName === 'Zeta Hiếm Gặp')).toBe(false);

    act(() => result.current.setCustomerSearch('zeta hiem'));
    expect(result.current.customers.some((customer) => customer.fullName === 'Zeta Hiếm Gặp')).toBe(false); // chưa hết debounce
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.customers.map((customer) => customer.fullName)).toEqual(['Zeta Hiếm Gặp']);
  });
});
