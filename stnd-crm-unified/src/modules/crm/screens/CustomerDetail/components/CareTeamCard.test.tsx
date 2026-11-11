import { useState } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../../test/renderCrm';
import { withCareTeamMembers, withEmptyCareTeam, withLockedUser, type CrmHarness } from '../../../../../test/crmHarness';
import { useCrmApi, useCustomerDetail } from '@crm/api';
import { CareTeamCard } from './CareTeamCard';

afterEach(signOut);

const Host = ({ customerId }: { customerId: string }) => {
  const { data } = useCustomerDetail(customerId);
  return data ? <CareTeamCard customer={data} /> : <p>Không có khách</p>;
};

const careTeamOf = (harness: CrmHarness, customerId: string) => harness.state().customers.find((customer) => customer.id === customerId)?.careTeam ?? [];
const nameOf = (harness: CrmHarness, userId: string): string => {
  const user = harness.state().users.find((item) => item.id === userId);
  if (!user) throw new Error(`Không có người dùng mẫu ${userId}`);
  return user.displayName;
};

describe('CareTeamCard: người chăm sóc chính bị khóa', () => {
  it('Quản lý: PRIMARY có nhãn "Người chăm sóc chính", "Chủ khách", "cố định" và KHÔNG có nút đổi/gỡ', () => {
    const { harness } = renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh' });
    const primaryRow = screen.getByText('Người chăm sóc chính').closest('li') as HTMLElement;
    expect(within(primaryRow).getByText('Chủ khách')).toBeInTheDocument();
    expect(within(primaryRow).getByText('cố định')).toBeInTheDocument();
    expect(within(primaryRow).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(`Gỡ ${nameOf(harness, 'hanh')}`) })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /đổi|chuyển|thay/i })).not.toBeInTheDocument();
  });

  it('không còn giao diện đề nghị tham gia nhóm', () => {
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin' });
    expect(screen.queryByText(/đề nghị|xin tham gia|tham gia nhóm|duyệt|từ chối/i)).not.toBeInTheDocument();
  });

  it('tài khoản thành viên bị khóa: hiện "(đã khóa)" cạnh tên', () => {
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin', mutate: withLockedUser('thao') });
    expect(screen.getByText('(đã khóa)')).toBeInTheDocument();
  });
});

describe('CareTeamCard: quyền mời/gỡ thành viên phụ', () => {
  it('Quản lý: có "Mời thành viên", số "1/10 thành viên phụ" và nút gỡ thành viên phụ', () => {
    const { harness } = renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh' });
    expect(screen.getByRole('button', { name: 'Mời thành viên' })).toBeEnabled();
    expect(screen.getByLabelText('Số thành viên phụ')).toHaveTextContent('1/10 thành viên phụ');
    expect(screen.getByRole('button', { name: `Gỡ ${nameOf(harness, 'thao')} khỏi nhóm chăm sóc` })).toBeInTheDocument();
  });

  it('Nhân viên là PRIMARY (thao, CUST-012): thấy "Mời thành viên"', () => {
    renderCrm(<Host customerId="CUST-012" />, { actAs: 'thao' });
    expect(screen.getByRole('button', { name: 'Mời thành viên' })).toBeInTheDocument();
  });

  it('Nhân viên chỉ là MEMBER (thao, CUST-001): không có "Mời thành viên" và không có nút gỡ', () => {
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'thao' });
    expect(screen.getByText('Thành viên phụ')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mời thành viên' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Gỡ / })).not.toBeInTheDocument();
  });

  it('mời nhiều người một lần: nhóm có thêm các MEMBER, hộp mời đóng lại, không gửi người chăm sóc chính mới', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh' });
    await user.click(screen.getByRole('button', { name: 'Mời thành viên' }));
    expect(screen.getByRole('button', { name: /^Mời$/ })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /^Tuấn ·/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Trang ·/ }));
    await user.click(screen.getByRole('button', { name: 'Mời (2)' }));
    await waitFor(() => expect(careTeamOf(harness, 'CUST-001').map((member) => member.userId)).toEqual(expect.arrayContaining(['hanh', 'thao', 'tuan', 'trang'])));
    const team = careTeamOf(harness, 'CUST-001');
    expect(team.filter((member) => member.role === 'PRIMARY').map((member) => member.userId)).toEqual(['hanh']);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Số thành viên phụ')).toHaveTextContent('3/10 thành viên phụ');
  });

  it('gỡ thành viên phụ: người đó rời nhóm, PRIMARY còn nguyên', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh' });
    await user.click(screen.getByRole('button', { name: `Gỡ ${nameOf(harness, 'thao')} khỏi nhóm chăm sóc` }));
    await waitFor(() => expect(careTeamOf(harness, 'CUST-001').map((member) => member.userId)).toEqual(['hanh']));
  });

  it('Hủy hộp mời: đóng hộp và xóa lựa chọn', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh' });
    await user.click(screen.getByRole('button', { name: 'Mời thành viên' }));
    await user.click(screen.getAllByRole('checkbox')[0]);
    await user.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mời thành viên' }));
    expect(screen.getByText('Chưa chọn ai.')).toBeInTheDocument();
  });
});

describe('CareTeamCard: giới hạn 10 thành viên phụ', () => {
  it('đủ 10/10: nút "Mời thành viên" bị khóa kèm giải thích, không mở được hộp mời', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh', mutate: withCareTeamMembers('CUST-001', 10) });
    expect(screen.getByLabelText('Số thành viên phụ')).toHaveTextContent('10/10 thành viên phụ');
    const invite = screen.getByRole('button', { name: 'Mời thành viên' });
    expect(invite).toBeDisabled();
    expect(screen.getByText(/Đã đủ 10 thành viên phụ/)).toBeInTheDocument();
    await user.click(invite);
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('9/10: còn 1 chỗ, chỉ chọn được 1 người', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh', mutate: withCareTeamMembers('CUST-001', 9) });
    expect(screen.getByRole('button', { name: 'Mời thành viên' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Mời thành viên' }));
    expect(screen.getByText(/còn tối đa 1/)).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]);
    expect(boxes[1]).toBeDisabled();
  });

  it('server báo CARE_TEAM_LIMIT_EXCEEDED (nhóm đầy trong lúc chọn): hiện lỗi ngay trong hộp mời và giữ hộp mở', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh', mutate: withCareTeamMembers('CUST-001', 8) });
    await user.click(screen.getByRole('button', { name: 'Mời thành viên' }));
    await user.click(screen.getByRole('checkbox', { name: /^Tuấn ·/ }));
    await user.click(screen.getByRole('checkbox', { name: /^Trang ·/ }));
    // Có người khác mời thêm 1 thành viên ngay trước khi bấm Mời: còn 1 chỗ nhưng đang chọn 2 người.
    await act(async () => {
      await harness.api.addCareTeamMembers('CUST-001', { userIds: ['thao'] });
    });
    await user.click(screen.getByRole('button', { name: 'Mời (2)' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/vượt giới hạn 10 thành viên phụ/);
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(careTeamOf(harness, 'CUST-001').map((member) => member.userId)).not.toContain('tuan');
  });
});

/** Gọi thẳng `addCareTeamMembers` với id Quản trị thuần để chứng minh mock KHÔNG che lỗi USER_NOT_ASSIGNABLE (BE cũng từ chối Quản trị làm phụ trách). */
const AdminAsPrimaryProbe = () => {
  const api = useCrmApi();
  const [code, setCode] = useState('');
  return (
    <button
      type="button"
      onClick={() => {
        void api.addCareTeamMembers('CUST-001', { userIds: ['admin'], primaryUserId: 'admin' }).then((result) => setCode(result.ok ? 'OK' : result.error.errorCode));
      }}
    >
      Thử đặt Quản trị
      <span data-testid="probe-code">{code}</span>
    </button>
  );
};

describe('CareTeamCard: "Chính tôi" khi đặt người chăm sóc chính ban đầu', () => {
  it('Quản lý (hanh) thấy "Chính tôi" ghim đầu danh sách (dù danh sách mời loại chính mình); chọn và đặt: PRIMARY = chính người gọi', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh', mutate: withEmptyCareTeam('CUST-001') });
    await user.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName('Chính tôi');
    expect(screen.queryByRole('radio', { name: /^Hạnh ·/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Chính tôi' }));
    expect(screen.getByText('Đã chọn 1: Chính tôi')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    await waitFor(() => expect(careTeamOf(harness, 'CUST-001')).toMatchObject([{ userId: 'hanh', role: 'PRIMARY' }]));
    expect(careTeamOf(harness, 'CUST-001')).toHaveLength(1);
    expect(await screen.findByText('Chủ khách')).toBeInTheDocument();
  });

  it('chọn "Chính tôi" rồi đổi sang người khác (và ngược lại): chỉ giữ một lựa chọn', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh', mutate: withEmptyCareTeam('CUST-001') });
    await user.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    await user.click(screen.getByRole('radio', { name: 'Chính tôi' }));
    await user.click(screen.getByRole('radio', { name: /^Tuấn ·/ }));
    expect(screen.getByRole('radio', { name: 'Chính tôi' })).not.toBeChecked();
    expect(screen.getByText('Đã chọn 1: Tuấn')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Chính tôi' }));
    expect(screen.getByRole('radio', { name: /^Tuấn ·/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    await waitFor(() => expect(careTeamOf(harness, 'CUST-001')).toMatchObject([{ userId: 'hanh', role: 'PRIMARY' }]));
  });

  it('Quản trị thuần không có "Chính tôi" (không chăm sóc được, QT6); mock vẫn từ chối USER_NOT_ASSIGNABLE khi gửi id Quản trị', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(
      <>
        <Host customerId="CUST-001" />
        <AdminAsPrimaryProbe />
      </>,
      { actAs: 'admin', mutate: withEmptyCareTeam('CUST-001') },
    );
    await user.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.queryByRole('radio', { name: 'Chính tôi' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Thử đặt Quản trị/ }));
    await waitFor(() => expect(screen.getByTestId('probe-code')).toHaveTextContent('USER_NOT_ASSIGNABLE'));
    expect(careTeamOf(harness, 'CUST-001')).toHaveLength(0);
  });

  it('khách đã có PRIMARY: hộp mời thành viên phụ không có "Chính tôi"', async () => {
    const user = userEvent.setup();
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'hanh' });
    await user.click(screen.getByRole('button', { name: 'Mời thành viên' }));
    expect(screen.queryByRole('checkbox', { name: 'Chính tôi' })).not.toBeInTheDocument();
  });
});

describe('CareTeamCard: đặt người chăm sóc chính một lần (khách chưa có nhóm)', () => {
  it.each([['admin'], ['hanh']])('%s thấy "Đặt người chăm sóc chính", không thấy "Mời thành viên"; đặt xong thì PRIMARY bị khóa', async (userId) => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<Host customerId="CUST-001" />, { actAs: userId, mutate: withEmptyCareTeam('CUST-001') });
    expect(screen.getByText('Chưa có người chăm sóc chính.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mời thành viên' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Số thành viên phụ')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Đặt người chăm sóc chính' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^Tuấn ·/ }));
    await user.click(screen.getByRole('button', { name: 'Đặt làm người chăm sóc chính' }));
    await waitFor(() => expect(careTeamOf(harness, 'CUST-001')).toMatchObject([{ userId: 'tuan', role: 'PRIMARY' }]));
    // Sau khi đặt: không còn nút đặt lại, có "Chủ khách" và có nút mời thành viên.
    expect(screen.queryByRole('button', { name: 'Đặt người chăm sóc chính' })).not.toBeInTheDocument();
    expect(await screen.findByText('Chủ khách')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mời thành viên' })).toBeInTheDocument();
  });

  it('khách đã có người chăm sóc chính: không có nút đặt người chăm sóc chính', () => {
    renderCrm(<Host customerId="CUST-001" />, { actAs: 'admin' });
    expect(screen.queryByRole('button', { name: 'Đặt người chăm sóc chính' })).not.toBeInTheDocument();
  });
});
