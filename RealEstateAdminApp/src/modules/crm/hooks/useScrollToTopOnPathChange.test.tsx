import { act, render } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollToTopOnPathChange } from './useScrollToTopOnPathChange';

const navigateRef: { current: ReturnType<typeof useNavigate> | null } = { current: null };
const Harness = () => {
  useScrollToTopOnPathChange();
  navigateRef.current = useNavigate();
  return null;
};

const scrollTo = vi.fn();
beforeEach(() => {
  scrollTo.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo);
  render(
    <MemoryRouter initialEntries={['/crm/customers/a', '/crm/appointments/new?customerId=a']} initialIndex={1}>
      <Harness />
    </MemoryRouter>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe('cuộn về đầu trang khi đổi màn CRM', () => {
  it('lần hiển thị đầu không cuộn', () => {
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('đổi pathname bằng PUSH hoặc REPLACE (vd lưu form về chi tiết khách): cuộn về đầu', () => {
    act(() => navigateRef.current?.('/crm/customers/a', { replace: true }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, left: 0 });
    act(() => navigateRef.current?.('/crm/appointments'));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('chỉ đổi query: không cuộn', () => {
    act(() => navigateRef.current?.('/crm/appointments/new?customerId=b'));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('Back (POP): không cuộn, để trình duyệt khôi phục vị trí cũ', () => {
    act(() => navigateRef.current?.(-1));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
