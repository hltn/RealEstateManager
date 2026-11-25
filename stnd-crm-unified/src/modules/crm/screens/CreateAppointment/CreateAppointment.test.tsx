import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { renderCrm, signOut } from '../../../../test/renderCrm';
import { withoutPhone, type CrmHarness } from '../../../../test/crmHarness';
import CreateAppointmentDesktop from './CreateAppointment.desktop';
import CreateAppointmentMobile from './CreateAppointment.mobile';

afterEach(signOut);

const codeOf = (harness: CrmHarness, customerId: string): string => {
  const code = harness.state().customers.find((customer) => customer.id === customerId)?.customerCode;
  if (!code) throw new Error(`Khách mẫu ${customerId} chưa có mã`);
  return code;
};

describe('Đặt lịch hẹn (desktop): chọn khách', () => {
  it('khách mở sẵn (khóa) chưa có SĐT: thẻ khách hiện mã, không hiện SĐT, không lỗi', async () => {
    const { harness } = renderCrm(<CreateAppointmentDesktop />, { route: '/crm/appointments/new?customerId=CUST-017' });
    expect((await screen.findAllByText('Mai Thị Hồng')).length).toBeGreaterThan(0);
    expect(screen.getByText(codeOf(harness, 'CUST-017'))).toBeInTheDocument();
    expect(screen.queryByText(/—\s*$/)).not.toBeInTheDocument();
  });

  it('danh sách chọn khách: dòng phụ "mã • SĐT • tình trạng"; khách chưa có SĐT chỉ "mã • tình trạng"', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<CreateAppointmentDesktop />, { route: '/crm/appointments/new' });
    await user.click(await screen.findByRole('button', { name: 'Chọn khách' }));
    expect(screen.getByPlaceholderText('Tìm tên, SĐT hoặc mã KH-…')).toBeInTheDocument();
    const list = screen.getByRole('listbox', { name: 'Danh sách khách hàng' });
    const lineOf = (name: string) => within(list).getByText(name).parentElement?.textContent ?? '';
    expect(lineOf('Mai Thị Hồng')).toContain(codeOf(harness, 'CUST-017'));
    expect(lineOf('Mai Thị Hồng')).not.toMatch(/null|undefined|•\s*•/);
    expect(lineOf('Nguyễn Văn An')).toContain(codeOf(harness, 'CUST-001'));
    expect(lineOf('Nguyễn Văn An')).toContain('•••');
  });

  it('tìm khách theo mã KH-… trong ô chọn khách', async () => {
    const user = userEvent.setup();
    const { harness } = renderCrm(<CreateAppointmentDesktop />, { route: '/crm/appointments/new' });
    await user.click(await screen.findByRole('button', { name: 'Chọn khách' }));
    await user.type(screen.getByLabelText('Tìm khách hàng'), codeOf(harness, 'CUST-017'));
    const list = screen.getByRole('listbox', { name: 'Danh sách khách hàng' });
    await waitFor(() => expect(within(list).queryByText('Nguyễn Văn An')).not.toBeInTheDocument());
    expect(within(list).getByText('Mai Thị Hồng')).toBeInTheDocument();
  });
});

describe('Đặt lịch hẹn (mobile): chọn khách', () => {
  it('ô chọn khách liệt kê "tên — mã · SĐT" và khách chưa có SĐT chỉ có mã', async () => {
    const { harness } = renderCrm(<CreateAppointmentMobile />, { route: '/crm/appointments/new' });
    const select = (await screen.findAllByRole('combobox')).find((element) => within(element).queryByText(/Mai Thị Hồng/));
    expect(select).toBeDefined();
    const option = within(select as HTMLElement).getByText(/Mai Thị Hồng/);
    expect(option.textContent).toContain(codeOf(harness, 'CUST-017'));
    expect(option.textContent).not.toMatch(/null|undefined|·\s*$/);
  });

  it('khách bị xóa SĐT sau khi tạo: vẫn chọn được, nhãn chỉ có tên và mã', async () => {
    const { harness } = renderCrm(<CreateAppointmentMobile />, { route: '/crm/appointments/new', mutate: withoutPhone('CUST-001') });
    const options = await screen.findAllByText(/Nguyễn Văn An/);
    expect(options[0].textContent).toContain(codeOf(harness, 'CUST-001'));
    expect(options[0].textContent).not.toContain('•••');
  });
});
