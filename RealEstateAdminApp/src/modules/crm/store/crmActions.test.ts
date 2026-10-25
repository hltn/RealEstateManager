import { describe, expect, it, vi } from 'vitest';
import { createCrmActions } from './crmActions';

const setup = () => {
  const router = { navigateTo: vi.fn(), goBack: vi.fn() };
  const actions = createCrmActions({ dispatch: vi.fn(), getState: vi.fn(), router } as unknown as Parameters<typeof createCrmActions>[0]);
  return { router, actions };
};

describe('goBack / goBackTo: nút Quay lại/Hủy truyền thẳng làm onClick không được rò sự kiện click thành fallbackPath', () => {
  it('goBack bỏ qua mọi đối số (vd MouseEvent từ onClick={goBack})', () => {
    const { router, actions } = setup();
    (actions.goBack as (...args: unknown[]) => void)({ type: 'click' });
    expect(router.goBack).toHaveBeenCalledTimes(1);
    expect(router.goBack).toHaveBeenCalledWith();
  });

  it('goBackTo chuyển đúng fallbackPath cho cầu nối router', () => {
    const { router, actions } = setup();
    actions.goBackTo('/crm/customers/abc');
    expect(router.goBack).toHaveBeenCalledWith('/crm/customers/abc');
  });
});
