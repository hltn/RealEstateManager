/**
 * `CustomerCard` - cả thẻ bấm được để mở chi tiết khách (như hàng bảng desktop), dùng ContactActionGrid THẬT:
 * chạm vùng trống / nút tên = đúng 1 lần `selectCustomer`; nút liên hệ không kích hoạt thẻ (chặn nổi bọt).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerListItem } from '@crm/api';

const mocks = vi.hoisted(() => ({
  selectCustomer: vi.fn(),
  callCustomer: vi.fn(),
  messageZalo: vi.fn(),
  openQuickNote: vi.fn(),
}));

vi.mock('@crm/store', () => ({ useCrmActions: () => ({ selectCustomer: mocks.selectCustomer }) }));
vi.mock('@crm/hooks/useContactActions', () => ({
  useContactActions: () => ({ callCustomer: mocks.callCustomer, messageZalo: mocks.messageZalo, openQuickNote: mocks.openQuickNote }),
}));

import { CustomerCard } from './CustomerCard';

const customer = (overrides: Partial<CustomerListItem> = {}): CustomerListItem => ({
  id: 'c1',
  fullName: 'Nguyễn Văn An',
  phoneMasked: '0912 ••• 678',
  purchasePurposes: [],
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

describe('CustomerCard - bấm thẻ mở chi tiết', () => {
  beforeEach(() => vi.clearAllMocks());

  const renderCard = () => render(<CustomerCard customer={customer()} />).container.querySelector('article') as HTMLElement;

  it('thẻ là vùng bấm được (con trỏ tay)', () => {
    expect(renderCard()).toHaveClass('cursor-pointer');
  });

  it('bấm vùng trống của thẻ -> selectCustomer đúng 1 lần với id khách', async () => {
    await userEvent.click(renderCard());
    expect(mocks.selectCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.selectCustomer).toHaveBeenCalledWith('c1');
  });

  it('bấm vào chữ không tương tác (SĐT) cũng mở chi tiết, đúng 1 lần', async () => {
    renderCard();
    await userEvent.click(screen.getByText('0912 ••• 678'));
    expect(mocks.selectCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.selectCustomer).toHaveBeenCalledWith('c1');
  });

  it('bấm nút tên -> đúng 1 lần (không gấp đôi do nút + thẻ)', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Nguyễn Văn An' }));
    expect(mocks.selectCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.selectCustomer).toHaveBeenCalledWith('c1');
  });

  it.each(['Enter', ' '])('bàn phím: focus nút tên rồi nhấn %j -> đúng 1 lần', async (key) => {
    renderCard();
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Nguyễn Văn An' })).toHaveFocus();
    await user.keyboard(key === ' ' ? ' ' : `{${key}}`);
    expect(mocks.selectCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.selectCustomer).toHaveBeenCalledWith('c1');
  });

  it.each([
    ['Gọi', 'callCustomer'],
    ['Zalo', 'messageZalo'],
    ['Ghi chú', 'openQuickNote'],
  ] as const)('bấm nút "%s" -> chạy hành động liên hệ, KHÔNG mở chi tiết', async (name, action) => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name }));
    expect(mocks[action]).toHaveBeenCalledWith('c1');
    expect(mocks.selectCustomer).not.toHaveBeenCalled();
  });

  it('bấm nút "Xem" -> mở chi tiết đúng 1 lần (nút tự xử lý, thẻ không gọi thêm)', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Xem' }));
    expect(mocks.selectCustomer).toHaveBeenCalledTimes(1);
    expect(mocks.selectCustomer).toHaveBeenCalledWith('c1');
  });

  it('bấm khe giữa các nút liên hệ (nền cụm nút) -> không mở chi tiết', async () => {
    renderCard();
    await userEvent.click(screen.getByRole('button', { name: 'Gọi' }).parentElement as HTMLElement);
    expect(mocks.selectCustomer).not.toHaveBeenCalled();
  });
});
