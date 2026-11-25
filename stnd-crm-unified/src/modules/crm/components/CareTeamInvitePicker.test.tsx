import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../test/renderCrm';
import { withExtraStaff } from '../../../test/crmHarness';
import { CareTeamInvitePicker } from './CareTeamInvitePicker';

afterEach(signOut);

const Host = ({ customerId, mode, max }: { customerId?: string; mode?: 'multiple' | 'single'; max?: number }) => {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <CareTeamInvitePicker customerId={customerId} selectionMode={mode} maxSelectable={max} selectedIds={selected} onSelectedChange={setSelected} />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  );
};

const PinnedHost = () => {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <CareTeamInvitePicker customerId="CUST-001" selectionMode="single" selectedIds={selected} onSelectedChange={setSelected} pinnedOption={{ id: 'hanh', label: 'Chính tôi' }} />
      <output data-testid="selected">{selected.join(',')}</output>
    </>
  );
};

const optionItems = () => within(screen.getByRole('list', { name: 'Danh sách người có thể mời' })).queryAllByRole('listitem');

describe('CareTeamInvitePicker', () => {
  it('hiện "tên · nhóm" và không lộ email/SĐT', () => {
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin' });
    const items = optionItems();
    expect(items.length).toBeGreaterThan(0);
    items.forEach((item) => expect(item.textContent).toContain(' · '));
    expect(screen.getByRole('list', { name: 'Danh sách người có thể mời' }).textContent).not.toMatch(/@|\d{4}/);
    // Người đã trong nhóm của khách (Hạnh = chính, Thảo = thành viên) và chính người gọi không xuất hiện.
    expect(screen.queryByText(/^Hạnh ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Thảo ·/)).not.toBeInTheDocument();
  });

  it('tìm theo tên có debounce: chưa đổi ngay khi gõ, đổi sau khoảng trễ', async () => {
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin', mutate: withExtraStaff(5) });
    const initial = optionItems().length;
    expect(initial).toBeGreaterThan(1);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm người để mời' }), { target: { value: 'Thử 03' } });
    // Đổi tức thì: danh sách chưa truy vấn lại (đang chờ debounce), rồi mới lọc.
    expect(optionItems()).toHaveLength(initial);
    await waitFor(() => expect(optionItems()).toHaveLength(1));
    expect(optionItems()[0].textContent).toContain('Thử 03');
  });

  it('không có kết quả: báo "Không tìm thấy người phù hợp."', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin' });
    await user.type(screen.getByRole('searchbox'), 'zzzzzz');
    expect(await screen.findByText('Không tìm thấy người phù hợp.')).toBeInTheDocument();
  });

  it('phân trang: trang 1 đủ 20 người, "Trang sau" sang trang 2, không có "Trang trước" ở trang 1', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin', mutate: withExtraStaff(25) });
    expect(optionItems()).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Trang trước' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getByText(/Trang 2\/2/)).toBeInTheDocument();
    expect(optionItems().length).toBeGreaterThan(0);
    expect(optionItems().length).toBeLessThan(20);
    expect(screen.getByRole('button', { name: 'Trang sau' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Trang trước' }));
    expect(optionItems()).toHaveLength(20);
  });

  it('đang ở trang 2 mà đổi từ khóa: tự về trang 1 (không rơi vào trang rỗng của kết quả mới)', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin', mutate: withExtraStaff(25) });
    await user.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getByText(/Trang 2\/2/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm người để mời' }), { target: { value: 'Thử 0' } });
    await waitFor(() => expect(optionItems()).toHaveLength(9));
    expect(screen.queryByText('Không tìm thấy người phù hợp.')).not.toBeInTheDocument();
    expect(optionItems()[0].textContent).toContain('Thử 01');
  });

  it('pinnedOption: ghim đầu danh sách, chọn được, hiện tên trong "Đã chọn" và không bị ảnh hưởng bởi tìm kiếm', async () => {
    const user = userEvent.setup();
    renderCrm(<PinnedHost />, { actAs: 'hanh' });
    expect(optionItems()[0].textContent).toBe('Chính tôi');
    await user.click(screen.getByRole('radio', { name: 'Chính tôi' }));
    expect(screen.getByTestId('selected')).toHaveTextContent('hanh');
    expect(screen.getByText('Đã chọn 1: Chính tôi')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Tìm người để mời' }), { target: { value: 'zzzzzz' } });
    expect(await screen.findByText('Không tìm thấy người phù hợp.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Chính tôi' })).toBeChecked();
  });

  it('một trang: không vẽ thanh phân trang', () => {
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin' });
    expect(screen.queryByRole('navigation', { name: 'Phân trang danh sách người mời' })).not.toBeInTheDocument();
  });

  it('chọn nhiều: giữ lựa chọn khi sang trang khác và hiện tên người đã chọn', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin', mutate: withExtraStaff(25) });
    const [first, second] = screen.getAllByRole('checkbox');
    await user.click(first);
    await user.click(second);
    expect(screen.getByTestId('selected').textContent?.split(',')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Trang sau' }));
    expect(screen.getByText(/^Đã chọn 2:/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText(/^Đã chọn 3:/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getByText(/^Đã chọn 2:/)).toBeInTheDocument();
  });

  it('chế độ chọn một: radio, chọn người khác thay người cũ', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" mode="single" />, { actAs: 'admin' });
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThan(1);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(radios[0]);
    await user.click(radios[1]);
    expect(screen.getByTestId('selected').textContent?.split(',')).toHaveLength(1);
    expect(radios[1]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });

  it('maxSelectable: đủ số chỗ thì các ô còn lại bị khóa, bỏ chọn thì mở lại', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" max={2} />, { actAs: 'admin', mutate: withExtraStaff(5) });
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]);
    await user.click(boxes[1]);
    expect(boxes[2]).toBeDisabled();
    expect(screen.getByText(/tối đa 2/)).toBeInTheDocument();
    expect(boxes[0]).toBeEnabled();
    await user.click(boxes[0]);
    await waitFor(() => expect(boxes[2]).toBeEnabled());
  });

  it('không có customerId (thao tác hàng loạt): Quản lý thấy người để mời; Nhân viên thì rỗng', () => {
    const manager = renderCrm(<Host />, { actAs: 'hanh' });
    expect(optionItems().length).toBeGreaterThan(0);
    manager.unmount();
    renderCrm(<Host />, { actAs: 'thao' });
    expect(screen.getByText('Không tìm thấy người phù hợp.')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
