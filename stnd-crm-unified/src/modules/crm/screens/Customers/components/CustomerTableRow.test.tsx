/** `CustomerTableRow` prototype (hàng bảng desktop): mã khách là nút chip gọn bấm để sao chép, không mở chi tiết của hàng. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';

const mocks = vi.hoisted(() => ({ copyTextToClipboard: vi.fn(), selectCustomer: vi.fn() }));
vi.mock('@crm/lib/clipboard', () => ({ copyTextToClipboard: mocks.copyTextToClipboard }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ selectCustomer: mocks.selectCustomer }) }));
vi.mock('@crm/components/TableContactActions', () => ({ TableContactActions: () => null }));

import { CustomerTableRow } from './CustomerTableRow';

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

const renderRow = (item: CustomerListItem) =>
  render(
    <table>
      <tbody>
        <CustomerTableRow customer={item} isSelected={false} onToggleSelect={vi.fn()} showPrimaryColumn={false} />
      </tbody>
    </table>,
  );

describe('CustomerTableRow (prototype) - mã khách là nút sao chép', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copyTextToClipboard.mockResolvedValue(true);
  });

  it('có nút đúng aria-label, kiểu chip gọn (min-h-6) để không làm lệch chiều cao hàng', () => {
    renderRow(customer());
    const button = screen.getByRole('button', { name: 'Sao chép mã khách KH-000053' });
    expect(button).toHaveClass('min-h-6');
    expect(button).not.toHaveClass('min-h-8');
  });

  it('bấm: chép đúng mã, KHÔNG mở chi tiết của hàng', async () => {
    renderRow(customer());
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã khách KH-000053' }));
    await waitFor(() => expect(mocks.copyTextToClipboard).toHaveBeenCalledExactlyOnceWith('KH-000053'));
    expect(mocks.selectCustomer).not.toHaveBeenCalled();
  });

  it('đối chứng: bấm vùng khác của hàng vẫn mở chi tiết và không sao chép', () => {
    renderRow(customer());
    fireEvent.click(screen.getByText('0912 ••• 678'));
    expect(mocks.selectCustomer).toHaveBeenCalledExactlyOnceWith('c1');
    expect(mocks.copyTextToClipboard).not.toHaveBeenCalled();
  });

  it('mã null: không có nút sao chép', () => {
    renderRow(customer({ customerCode: null }));
    expect(screen.queryByRole('button', { name: /Sao chép mã khách/ })).not.toBeInTheDocument();
  });
});
