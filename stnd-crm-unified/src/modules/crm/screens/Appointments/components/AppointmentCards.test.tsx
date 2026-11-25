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

/** Dựng thẻ từ MỘT lịch hẹn mẫu nhưng đổi loại + cờ `canEdit` (cờ do backend/mock trả; thẻ không được tự suy từ vai trò). */
const OverriddenCard = ({ variant, type, canEdit }: { variant: 'desktop' | 'mobile'; type: 'DEPOSIT_CONTRACT' | 'CALLBACK'; canEdit: boolean }) => {
  const { data } = useAppointments();
  const base = data[0];
  if (!base) return null;
  const appointment = { ...base, type, canEdit, canDelete: canEdit, status: 'SCHEDULED' as const };
  return variant === 'desktop' ? <AppointmentCardDesktop appointment={appointment} /> : <AppointmentCardMobile appointment={appointment} />;
};

describe.each([
  ['desktop', 'DEPOSIT_CONTRACT', /Xác nhận hoàn thành/],
  ['desktop', 'CALLBACK', /Đã liên hệ xong/],
  ['mobile', 'DEPOSIT_CONTRACT', /Xác nhận hoàn thành/],
] as const)('Nút hoàn thành lịch hẹn theo canEdit (FR-32): %s, %s', (variant, type, name) => {
  it('canEdit=false (không phải người tạo lịch, không phải Quản trị): KHÔNG có nút hoàn thành', () => {
    renderCrm(<OverriddenCard variant={variant} type={type} canEdit={false} />, { actAs: 'hanh' });
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('canEdit=true (người tạo lịch / Quản trị): có nút hoàn thành', () => {
    renderCrm(<OverriddenCard variant={variant} type={type} canEdit />, { actAs: 'hanh' });
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });
});

/** Dựng thẻ từ MỘT lịch hẹn mẫu, đổi loại/địa điểm/ghi chú/người thực hiện để kiểm dòng "Phụ trách" (FR-30). */
const AssigneeCard = ({
  variant,
  type,
  assignees,
  note = 'Khách hẹn gọi sau 5 giờ chiều',
}: {
  variant: 'desktop' | 'mobile';
  type: 'SITE_VISIT' | 'DEPOSIT_CONTRACT' | 'CALLBACK';
  assignees: { id: string; displayName: string }[];
  note?: string;
}) => {
  const { data } = useAppointments();
  const base = data[0];
  if (!base) return null;
  const appointment = { ...base, type, location: 'Sảnh tòa A', note, assignees, status: 'SCHEDULED' as const };
  return variant === 'desktop' ? <AppointmentCardDesktop appointment={appointment} /> : <AppointmentCardMobile appointment={appointment} />;
};

describe.each([['desktop'], ['mobile']] as const)('Thẻ lịch hẹn hiện dòng "Phụ trách" cho mọi loại lịch (FR-30): %s', (variant) => {
  const HANH = { id: 'u1', displayName: 'Hạnh' };
  const MINH = { id: 'u2', displayName: 'Minh' };

  it('"Nhắc gọi lại": hiện "Phụ trách" với 1 người, giữ ghi chú, KHÔNG hiện địa điểm', () => {
    renderCrm(<AssigneeCard variant={variant} type="CALLBACK" assignees={[HANH]} />, { actAs: 'hanh' });
    expect(screen.getByText(/Phụ trách:/)).toHaveTextContent('Phụ trách: Hạnh');
    expect(screen.getByText(/Khách hẹn gọi sau 5 giờ chiều/)).toBeInTheDocument();
    expect(screen.queryByText(/Sảnh tòa A/)).not.toBeInTheDocument();
  });

  it('"Nhắc gọi lại": nhiều người thì liệt kê đủ; danh sách rỗng giữ "—"; không ghi chú vẫn hiện "Phụ trách"', () => {
    const many = renderCrm(<AssigneeCard variant={variant} type="CALLBACK" assignees={[HANH, MINH]} />, { actAs: 'hanh' });
    expect(screen.getByText(/Phụ trách:/)).toHaveTextContent('Phụ trách: Hạnh, Minh');
    many.unmount();

    renderCrm(<AssigneeCard variant={variant} type="CALLBACK" assignees={[]} note="" />, { actAs: 'hanh' });
    expect(screen.getByText(/Phụ trách:/)).toHaveTextContent('Phụ trách: —');
    expect(screen.queryByText(/Ghi chú/)).not.toBeInTheDocument();
  });

  it.each(['SITE_VISIT', 'DEPOSIT_CONTRACT'] as const)('loại %s: vẫn hiện địa điểm và đúng MỘT dòng "Phụ trách"', (type) => {
    renderCrm(<AssigneeCard variant={variant} type={type} assignees={[HANH, MINH]} />, { actAs: 'hanh' });
    expect(screen.getAllByText(/Phụ trách:/)).toHaveLength(1);
    expect(screen.getByText(/Phụ trách:/)).toHaveTextContent('Phụ trách: Hạnh, Minh');
    expect(screen.getByText(/Sảnh tòa A/)).toBeInTheDocument();
  });
});
