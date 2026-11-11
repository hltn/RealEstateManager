import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { useAppointments } from '@crm/api';
import { renderCrm, signOut } from '../../../../../test/renderCrm';
import { withoutPhone } from '../../../../../test/crmHarness';
import { AppointmentCardDesktop } from './AppointmentCardDesktop';
import { AppointmentCardMobile } from './AppointmentCardMobile';

afterEach(signOut);

/** Vẽ thẻ cho mọi lịch hẹn của CUST-001 trong khoảng mặc định (lịch hẹn mẫu của khách này nằm hôm nay/tuần này). */
const Cards = ({ variant }: { variant: 'desktop' | 'mobile' }) => {
  const { data } = useAppointments();
  const mine = data.filter((appointment) => appointment.customer.id === 'CUST-001' && appointment.status === 'SCHEDULED');
  return (
    <div data-testid="cards">
      {mine.map((appointment) => (variant === 'desktop' ? <AppointmentCardDesktop key={appointment.id} appointment={appointment} /> : <AppointmentCardMobile key={appointment.id} appointment={appointment} />))}
    </div>
  );
};

describe.each([['desktop'], ['mobile']] as const)('Thẻ lịch hẹn (%s)', (variant) => {
  it('khách có SĐT: có ít nhất một thẻ và nút gọi nhanh', () => {
    renderCrm(<Cards variant={variant} />, { actAs: 'hanh' });
    expect(within(screen.getByTestId('cards')).getAllByRole('article').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Gọi nhanh|Gọi ngay cho khách/ }).length).toBeGreaterThan(0);
  });

  it('khách chưa có SĐT: thẻ vẫn hiện bình thường (tên khách), không có nút Gọi nhanh/Gọi ngay và không lỗi', () => {
    renderCrm(<Cards variant={variant} />, { actAs: 'hanh', mutate: withoutPhone('CUST-001') });
    expect(within(screen.getByTestId('cards')).getAllByRole('article').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Nguyễn Văn An/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Gọi nhanh|Gọi ngay cho khách/ })).not.toBeInTheDocument();
  });
});

describe('Menu "Thao tác khác" của lịch hẹn (desktop)', () => {
  it('có SĐT: có mục "Nhắn Zalo"; chưa có SĐT: không có', async () => {
    const user = userEvent.setup();
    const first = renderCrm(<Cards variant="desktop" />, { actAs: 'hanh' });
    await user.click(screen.getAllByRole('button', { name: 'Thao tác khác' })[0]);
    expect(screen.getByText('Nhắn Zalo')).toBeInTheDocument();
    first.unmount();

    renderCrm(<Cards variant="desktop" />, { actAs: 'hanh', mutate: withoutPhone('CUST-001') });
    await user.click(screen.getAllByRole('button', { name: 'Thao tác khác' })[0]);
    expect(screen.queryByText('Nhắn Zalo')).not.toBeInTheDocument();
  });
});
