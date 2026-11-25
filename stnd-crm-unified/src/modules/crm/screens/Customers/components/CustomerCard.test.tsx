/**
 * `CustomerCard` prototype (thẻ khách mobile): mã khách là nút chip bấm để sao chép, không kích hoạt nút tên / không lồng nút.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';

const mocks = vi.hoisted(() => ({ copyTextToClipboard: vi.fn(), selectCustomer: vi.fn() }));
vi.mock('@crm/lib/clipboard', () => ({ copyTextToClipboard: mocks.copyTextToClipboard }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ selectCustomer: mocks.selectCustomer }) }));
vi.mock('@crm/components/ContactActionGrid', () => ({ ContactActionGrid: () => null }));

import { CustomerCard } from './CustomerCard';

const customer = (overrides: Partial<CustomerListItem> = {}): CustomerListItem => ({
  id: 'c1',
  customerCode: 'KH-000053',
  fullName: 'Nguyễn Văn An',
  phoneMasked: '0912 ••• 678',
  status: { id: 'NOT_CONTACTED', code: 'NOT_CONTACTED', label: 'Chưa tiếp cận', listGroup: 'NOT_CONTACTED', tone: 'gray' },
  source: null,
  projects: [],
  area: null,
  tags: [],
  progress: 0,
  criteriaDone: { demand: false, motivation: false, finance: false, timing: false },
  primaryAssignee: null,
  careTeamSize: 0,
  nextAppointmentAt: null,
  lastCareLogAt: null,
  lastUpdatedAt: '2026-10-24T01:00:00.000Z',
  personaCompleteness: 0,
  ...overrides,
});

describe('CustomerCard (prototype) - mã khách là nút sao chép', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyTextToClipboard.mockResolvedValue(true);
  });

  it('bấm nút mã -> chép đúng mã, không mở chi tiết, nút không lồng trong nút/liên kết khác', async () => {
    render(<CustomerCard customer={customer()} showPrimaryAssignee={false} />);
    const copyButton = screen.getByRole('button', { name: 'Sao chép mã khách KH-000053' });
    expect(copyButton.parentElement?.closest('button, a')).toBeNull();
    await userEvent.click(copyButton);
    expect(mocks.copyTextToClipboard).toHaveBeenCalledExactlyOnceWith('KH-000053');
    expect(mocks.selectCustomer).not.toHaveBeenCalled();
  });

  // Enter bắn click ở keydown, Space bắn click ở keyup: cả hai phải sao chép và KHÔNG nổi bọt lên thẻ mở chi tiết.
  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('bàn phím: focus nút mã rồi nhấn %s -> sao chép đúng 1 lần, KHÔNG mở chi tiết', async (_label, keys) => {
    render(<CustomerCard customer={customer()} showPrimaryAssignee={false} />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Sao chép mã khách KH-000053' });
    for (let i = 0; i < 5 && document.activeElement !== button; i += 1) await user.tab();
    expect(button).toHaveFocus();
    await user.keyboard(keys);
    expect(mocks.copyTextToClipboard).toHaveBeenCalledExactlyOnceWith('KH-000053');
    expect(mocks.selectCustomer).not.toHaveBeenCalled();
  });

  it('nút tên vẫn mở chi tiết và KHÔNG sao chép', async () => {
    render(<CustomerCard customer={customer()} showPrimaryAssignee={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Nguyễn Văn An' }));
    expect(mocks.selectCustomer).toHaveBeenCalledExactlyOnceWith('c1');
    expect(mocks.copyTextToClipboard).not.toHaveBeenCalled();
  });

  it('mã null -> không có nút sao chép; khách không SĐT cũng không mã -> "Chưa có SĐT"', () => {
    render(<CustomerCard customer={customer({ customerCode: null, phoneMasked: null })} showPrimaryAssignee={false} />);
    expect(screen.queryByRole('button', { name: /Sao chép mã khách/ })).not.toBeInTheDocument();
    expect(screen.getByText('Chưa có SĐT')).toBeInTheDocument();
  });
});
