import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CareLogView, CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CareLogForm } from './CareLogForm';

// Cờ đọc lúc render nên đổi được giữa các ca; mặc định TẮT như production.
const flags = vi.hoisted(() => ({ isAttachmentsEnabled: false }));
vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: flags }));

const createCareLog = vi.fn();
const updateCareLog = vi.fn();
const deleteCareLogAttachment = vi.fn();

const catalogs = vi.hoisted(() => ({
  contactResults: [
    { id: 'r1', label: 'Quan tâm', isActive: true, order: 1, suggestionText: 'Gửi bảng giá', suggestedFollowUpDays: 2 },
    { id: 'r2', label: 'Hẹn xem nhà', isActive: true, order: 2, suggestionText: '', suggestedFollowUpDays: null },
    { id: 'r-old', label: 'Kết quả cũ đã ẩn', isActive: false, order: 3, suggestionText: '', suggestedFollowUpDays: null },
  ],
}));

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return {
    ...real,
    useCrmApi: () => ({ createCareLog, updateCareLog, deleteCareLogAttachment }),
    useCatalogs: () => ({ catalogs }),
  };
});

const customer = {
  id: '6add87b88f689f6e6cd96833',
  version: 1,
  status: { id: 's', label: 'Mới' },
  criteria: {},
  careTeam: [{ role: 'PRIMARY', user: { id: 'u-primary' } }],
} as unknown as CustomerDetail;

const savedLog: CareLogView = {
  id: 'log-1',
  customerId: customer.id,
  author: { id: 'u1', displayName: 'Hạnh' },
  isPrimaryAuthor: false,
  occurredAt: '2026-10-26T02:00:00.000Z',
  content: 'Đã gọi tư vấn lần 1',
  contactChannel: 'ZALO',
  contactResult: { id: 'r1', label: 'Quan tâm' },
  nextAction: { suggestion: 'Gọi lại', dueAt: '2026-10-28T02:00:00.000Z', appointmentId: null },
  source: 'MANUAL',
  images: [
    { src: 'https://s3.test/a.jpg', caption: 'Ảnh 1' },
    { src: 'https://s3.test/b.jpg', caption: 'Ảnh 2' },
  ],
  attachmentIds: ['att-1', 'att-2'],
  editedAt: null,
  canEdit: true,
};

const onClose = vi.fn();

const renderForm = (editingLog?: CareLogView, onGuardChange?: (guard: { isDirty: boolean; isSaving: boolean }) => void) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CareLogForm customer={customer} variant="desktop" editingLog={editingLog} onClose={onClose} onGuardChange={onGuardChange} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  flags.isAttachmentsEnabled = false;
  onClose.mockReset();
  createCareLog.mockReset();
  updateCareLog.mockReset();
  deleteCareLogAttachment.mockReset();
  createCareLog.mockResolvedValue({ ok: true, data: {} });
  updateCareLog.mockResolvedValue({ ok: true, data: {} });
});

describe('G1: khung tải ảnh trong form ghi nhật ký theo cờ CRM_ATTACHMENTS_ENABLED', () => {
  it('cờ bật: thấy nút "Thêm ảnh" (ô chọn file chỉ nhận jpeg/png/webp) và dòng giới hạn 5 MB / 5 ảnh', () => {
    flags.isAttachmentsEnabled = true;
    renderForm();
    expect(screen.getByText('Thêm ảnh')).toBeVisible();
    expect(document.querySelector('input[type="file"]')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    expect(screen.getByText(/JPEG, PNG hoặc WebP, tối đa 5 MB mỗi ảnh, tối đa 5 ảnh/)).toBeVisible();
  });

  it('cờ tắt: ẩn hoàn toàn khung tải ảnh như cũ', () => {
    renderForm();
    expect(screen.queryByText('Thêm ảnh')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('PT-020: form ghi chú/chăm sóc hiện ĐẦY ĐỦ khi được mở', () => {
  it('đủ nội dung, kênh liên hệ, kết quả liên hệ, nhắc việc tiếp theo (việc + công tắc lịch hẹn) và ảnh (cờ bật); chưa bật lịch hẹn thì chưa có ô ngày giờ', () => {
    flags.isAttachmentsEnabled = true;
    renderForm();
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Kênh liên hệ' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Kết quả liên hệ' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Nhắc việc tiếp theo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Việc cần làm tiếp theo' })).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Tạo lịch hẹn' })).toBeVisible();
    expect(screen.queryByLabelText('Thời điểm nhắc')).toBeNull();
    expect(screen.queryByLabelText(/Ngày diễn ra/)).toBeNull();
    expect(screen.getByText('Thêm ảnh')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lưu nhật ký' })).toBeDisabled();
  });

  it('chỉ liệt kê kết quả liên hệ đang dùng khi thêm mới', () => {
    renderForm();
    expect(screen.getByRole('option', { name: 'Quan tâm' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Kết quả cũ đã ẩn' })).toBeNull();
  });

  it('lưu thành công: gọi createCareLog đúng dữ liệu rồi ĐÓNG form (onClose)', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), 'Khách hẹn xem nhà');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kênh liên hệ' }), 'ZALO');
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(createCareLog).toHaveBeenCalledWith(customer.id, expect.objectContaining({ content: 'Khách hẹn xem nhà', contactChannel: 'ZALO', contactResultId: null, attachmentIds: [] }), 'u-primary');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('lưu thất bại: KHÔNG đóng form (giữ nội dung đã gõ để thử lại)', async () => {
    createCareLog.mockResolvedValue({ ok: false, error: { statusCode: 500, errorCode: 'X', message: 'Lỗi hệ thống' } });
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), 'Nội dung quan trọng');
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Nội dung quan trọng');
  });

  it('nút Hủy và nút X đều đóng form mà không gọi API lưu', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    await user.click(screen.getByRole('button', { name: 'Đóng form ghi chú' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(createCareLog).not.toHaveBeenCalled();
  });

  it('chọn kết quả liên hệ có gợi ý: điền sẵn việc tiếp theo (khi thêm mới); mốc hẹn gợi ý chờ đến khi bật "Tạo lịch hẹn" (xem mục lịch hẹn)', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r1');
    expect(screen.getByRole('textbox', { name: 'Việc cần làm tiếp theo' })).toHaveValue('Gửi bảng giá');
    expect(screen.queryByLabelText(/Ngày diễn ra/)).toBeNull();
  });
});

/** Mốc "bây giờ" cố định (07:00 giờ VN 2026-10-22) để ngày giờ mặc định hôm nay 09:30 luôn nằm ở tương lai. */
const NOW_FOR_APPOINTMENT_TESTS = new Date('2026-10-22T00:00:00.000Z');
const TODAY_KEY = '2026-10-22';
const FUTURE_DATE = '2026-10-25';

/** Đặt ngày cho ô flatpickr (ô ngày không gõ tay được) như người dùng chọn trên lịch. */
const pickDate = (date: string) => {
  const input = screen.getByLabelText(/Ngày diễn ra/) as HTMLInputElement & { _flatpickr: { setDate: (value: string, shouldTrigger: boolean) => void } };
  act(() => input._flatpickr.setDate(date, true));
};

const getSwitch = () => screen.getByRole('switch', { name: 'Tạo lịch hẹn' });

describe('công tắc "Tạo lịch hẹn" trong "Nhắc việc tiếp theo"', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_FOR_APPOINTMENT_TESTS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const fillContent = async (user: ReturnType<typeof userEvent.setup>) => user.type(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), 'Khách hẹn xem nhà');
  const lastBody = () => createCareLog.mock.calls[0][1];

  it('là công tắc role="switch" (không còn checkbox), mặc định tắt, nhãn bên trái và công tắc bên phải cùng một hàng', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(getSwitch()).toHaveAttribute('aria-checked', 'false');
    // Hàng: [nhãn][công tắc] — công tắc là phần tử cuối (bên phải) của hàng căn đều hai đầu.
    const row = getSwitch().parentElement as HTMLElement;
    expect(row.className).toContain('justify-between');
    expect(row.lastElementChild).toBe(getSwitch());
    expect(row.firstElementChild).toHaveTextContent('Tạo lịch hẹn');
    await user.click(getSwitch());
    expect(getSwitch()).toHaveAttribute('aria-checked', 'true');
    await user.click(getSwitch());
    expect(getSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('TẮT: không có ô Ngày diễn ra / Giờ / Nhắc trước; lưu chỉ gửi việc tiếp theo, KHÔNG có dueAt và KHÔNG có appointment', async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByLabelText(/Ngày diễn ra/)).toBeNull();
    expect(screen.queryByLabelText(/Giờ \(giờ Việt Nam\)/)).toBeNull();
    expect(screen.queryByLabelText('Nhắc trước')).toBeNull();
    await fillContent(user);
    await user.type(screen.getByRole('textbox', { name: 'Việc cần làm tiếp theo' }), 'Gọi lại báo giá');
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(lastBody().nextAction).toEqual({ suggestion: 'Gọi lại báo giá', dueAt: null, appointment: undefined });
  });

  it('TẮT và không nhập việc tiếp theo: không gửi nextAction', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(lastBody().nextAction).toBeUndefined();
  });

  it('BẬT: xổ ra đúng 3 ô Ngày diễn ra, Giờ, Nhắc trước với mặc định hôm nay 09:30 và "Trước 1 tiếng" (như form Tạo lịch hẹn)', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(getSwitch());
    expect(getSwitch()).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue(TODAY_KEY);
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:30');
    const reminder = screen.getByRole('combobox', { name: 'Nhắc trước' });
    expect(reminder).toHaveValue('60');
    expect(screen.getByRole('option', { name: 'Trước 1 tiếng' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Thời điểm nhắc')).toBeNull();
  });

  it('BẬT: lưu gửi dueAt = ngày + giờ đã chọn (giờ VN -> UTC) và appointment CALLBACK kèm remindBeforeMinutes mặc định [60]', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.click(getSwitch());
    pickDate(FUTURE_DATE);
    fireEvent.change(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/), { target: { value: '10:15' } });
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(lastBody().nextAction).toEqual({ suggestion: '', dueAt: '2026-10-25T03:15:00.000Z', appointment: { type: 'CALLBACK', remindBeforeMinutes: [60] } });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('BẬT: đổi "Nhắc trước" thì gửi đúng mốc đã chọn', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.click(getSwitch());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Nhắc trước' }), '1440');
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(lastBody().nextAction.appointment).toEqual({ type: 'CALLBACK', remindBeforeMinutes: [1440] });
  });

  it('BẬT rồi TẮT lại: giữ giá trị đã nhập khi bật lại, nhưng lúc tắt không gửi dueAt/appointment', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.click(getSwitch());
    pickDate(FUTURE_DATE);
    await user.click(getSwitch());
    expect(screen.queryByLabelText(/Ngày diễn ra/)).toBeNull();
    await user.click(getSwitch());
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue(FUTURE_DATE);
    await user.click(getSwitch());
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(lastBody().nextAction).toBeUndefined();
  });

  it('BẬT + ngày ở quá khứ: báo "Ngày hẹn không được ở quá khứ.", đưa tiêu điểm vào ô ngày, KHÔNG gọi API; sửa lại thì lưu được', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.click(getSwitch());
    pickDate('2026-10-20');
    expect(screen.queryByText('Ngày hẹn không được ở quá khứ.')).toBeNull(); // chưa bấm Lưu thì chưa báo lỗi
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    expect(await screen.findByText('Ngày hẹn không được ở quá khứ.')).toBeVisible();
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveFocus();
    expect(createCareLog).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    pickDate(FUTURE_DATE);
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
  });

  it('BẬT + giờ hôm nay đã qua: báo "Giờ hẹn không được ở quá khứ." ở ô Giờ', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.click(getSwitch());
    fireEvent.change(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/), { target: { value: '06:00' } }); // bây giờ là 07:00 VN
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    expect(await screen.findByText('Giờ hẹn không được ở quá khứ.')).toBeVisible();
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveFocus();
    expect(createCareLog).not.toHaveBeenCalled();
  });

  it('BẬT + xóa giờ: báo "Vui lòng nhập giờ hợp lệ (HH:mm)." và không gọi API', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.click(getSwitch());
    fireEvent.change(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    expect(await screen.findByText('Vui lòng nhập giờ hợp lệ (HH:mm).')).toBeVisible();
    expect(createCareLog).not.toHaveBeenCalled();
  });

  it('chọn kết quả liên hệ có gợi ý rồi bật công tắc: ngày hẹn điền sẵn theo gợi ý (hôm nay + 2 ngày, 09:00)', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r1');
    await user.click(getSwitch());
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue('2026-10-24');
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:00');
  });

  it('bật công tắc TRƯỚC rồi mới chọn kết quả liên hệ: mốc gợi ý thay mốc mặc định do công tắc điền (hôm nay + 2 ngày, 09:00)', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(getSwitch());
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue(TODAY_KEY);
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:30');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r1');
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue('2026-10-24');
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:00');
  });

  it('bật công tắc, ĐÃ tự sửa ngày rồi mới chọn kết quả liên hệ: giữ nguyên ngày/giờ người dùng đã chọn', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(getSwitch());
    pickDate(FUTURE_DATE);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r1');
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue(FUTURE_DATE);
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:30');
  });

  it('bật công tắc, ĐÃ tự sửa giờ rồi mới chọn kết quả liên hệ: giữ nguyên cả ngày lẫn giờ đã sửa (không ghi đè)', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(getSwitch());
    fireEvent.change(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/), { target: { value: '15:00' } });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r1');
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue(TODAY_KEY);
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('15:00');
  });

  it('bật công tắc rồi chọn kết quả KHÔNG có gợi ý mốc (r2): giữ mốc mặc định, không xóa trắng', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(getSwitch());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r2');
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue(TODAY_KEY);
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:30');
  });

  it('mốc gợi ý đã áp dụng (công tắc tắt) rồi bật công tắc: giữ mốc gợi ý đó, chọn kết quả khác không ghi đè', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r1'); // gợi ý 10-24 09:00 khi công tắc còn tắt
    await user.click(getSwitch());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r2');
    expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue('2026-10-24');
    expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:00');
  });

  it('dirty: mốc mặc định do công tắc điền chưa tính là bản nháp; tự chọn ngày thì tính; tắt công tắc thì mốc ẩn không tính (không hỏi bỏ bản nháp vì mốc ngầm)', async () => {
    const user = userEvent.setup();
    const onGuardChange = vi.fn();
    renderForm(undefined, onGuardChange);
    const isDirty = () => onGuardChange.mock.calls.at(-1)?.[0].isDirty;
    expect(isDirty()).toBe(false);
    await user.click(getSwitch());
    expect(isDirty()).toBe(false); // mới bật, còn mốc mặc định
    pickDate(FUTURE_DATE);
    expect(isDirty()).toBe(true); // người dùng đã chọn ngày
    await user.click(getSwitch());
    expect(isDirty()).toBe(false); // tắt: mốc ẩn không được gửi nên không tính
    await user.click(getSwitch());
    expect(isDirty()).toBe(true); // bật lại: mốc đã chỉnh tay quay lại
  });

  it('bật-tắt-bật có việc tiếp theo: giữ chữ việc tiếp theo; lúc tắt chỉ gửi suggestion với dueAt null và KHÔNG có appointment', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.type(screen.getByRole('textbox', { name: 'Việc cần làm tiếp theo' }), 'Gọi lại báo giá');
    await user.click(getSwitch());
    pickDate(FUTURE_DATE);
    await user.click(getSwitch());
    await user.click(getSwitch());
    expect(screen.getByRole('textbox', { name: 'Việc cần làm tiếp theo' })).toHaveValue('Gọi lại báo giá');
    await user.click(getSwitch());
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
    expect(lastBody().nextAction).toEqual({ suggestion: 'Gọi lại báo giá', dueAt: null, appointment: undefined });
    expect(lastBody().nextAction.dueAt).toBeNull();
    expect(lastBody().nextAction.appointment).toBeUndefined();
  });

  describe('múi giờ gần nửa đêm giờ VN (ngày VN lệch ngày UTC)', () => {
    it('00:10 VN ngày 23/10 (= 17:10 UTC ngày 22/10): ngày mặc định là ngày VN 2026-10-23 (không phải ngày UTC) và lưu ra đúng dueAt UTC', async () => {
      vi.setSystemTime(new Date('2026-10-22T17:10:00.000Z'));
      const user = userEvent.setup();
      renderForm();
      await fillContent(user);
      await user.click(getSwitch());
      expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue('2026-10-23');
      expect(screen.getByLabelText(/Giờ \(giờ Việt Nam\)/)).toHaveValue('09:30');
      await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
      await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
      expect(lastBody().nextAction.dueAt).toBe('2026-10-23T02:30:00.000Z');
    });

    it('23:50 VN ngày 22/10 (= 16:50 UTC): giờ mặc định 09:30 hôm nay đã qua nên bị chặn; chọn ngày mai thì lưu được', async () => {
      vi.setSystemTime(new Date('2026-10-22T16:50:00.000Z'));
      const user = userEvent.setup();
      renderForm();
      await fillContent(user);
      await user.click(getSwitch());
      expect(screen.getByLabelText(/Ngày diễn ra/)).toHaveValue(TODAY_KEY);
      await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
      expect(await screen.findByText('Giờ hẹn không được ở quá khứ.')).toBeVisible();
      expect(createCareLog).not.toHaveBeenCalled();
      pickDate('2026-10-23');
      await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
      await waitFor(() => expect(createCareLog).toHaveBeenCalledTimes(1));
      expect(lastBody().nextAction.dueAt).toBe('2026-10-23T02:30:00.000Z');
    });
  });

  it('lưu xong: form dọn về mặc định (công tắc tắt, nhắc trước 1 tiếng) cho lần ghi sau', async () => {
    const user = userEvent.setup();
    renderForm();
    await fillContent(user);
    await user.click(getSwitch());
    await user.selectOptions(screen.getByRole('combobox', { name: 'Nhắc trước' }), '120');
    await user.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(getSwitch()).toHaveAttribute('aria-checked', 'false');
    await user.click(getSwitch());
    expect(screen.getByRole('combobox', { name: 'Nhắc trước' })).toHaveValue('60');
  });
});

describe('PT-022: sửa nhật ký đã lưu (mở lại form với dữ liệu cũ, gồm ảnh)', () => {
  it('điền sẵn nội dung, kênh, kết quả liên hệ; tiêu đề/nút lưu là "Sửa"; ẩn khối nhắc việc tiếp theo (PATCH không nhận)', () => {
    renderForm(savedLog);
    expect(screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Đã gọi tư vấn lần 1');
    expect(screen.getByRole('combobox', { name: 'Kênh liên hệ' })).toHaveValue('ZALO');
    expect(screen.getByRole('combobox', { name: 'Kết quả liên hệ' })).toHaveValue('r1');
    expect(screen.queryByRole('group', { name: 'Nhắc việc tiếp theo' })).toBeNull();
    // Sửa nhật ký không có công tắc "Tạo lịch hẹn" (PATCH không nhận nextAction).
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByLabelText(/Ngày diễn ra/)).toBeNull();
    expect(screen.getByText(/được giữ nguyên/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeEnabled();
  });

  it('kết quả liên hệ của nhật ký đã bị ẩn khỏi danh mục vẫn chọn được (không mất dữ liệu cũ)', () => {
    renderForm({ ...savedLog, contactResult: { id: 'r-old', label: 'Kết quả cũ đã ẩn' } });
    expect(screen.getByRole('combobox', { name: 'Kết quả liên hệ' })).toHaveValue('r-old');
  });

  it('lưu: gọi updateCareLog (PATCH) đúng logId + dữ liệu mới, KHÔNG gọi createCareLog, rồi đóng form', async () => {
    const user = userEvent.setup();
    renderForm(savedLog);
    const content = screen.getByRole('textbox', { name: /Nội dung trao đổi/ });
    await user.clear(content);
    await user.type(content, 'Đã sửa nội dung');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kênh liên hệ' }), 'CALL');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(updateCareLog).toHaveBeenCalledTimes(1));
    // Cờ ảnh tắt (mặc định): KHÔNG gửi attachmentIds để không gỡ nhầm ảnh đã có.
    expect(updateCareLog).toHaveBeenCalledWith(customer.id, 'log-1', { content: 'Đã sửa nội dung', contactChannel: 'CALL', contactResultId: 'r1' }, 'u-primary');
    expect(createCareLog).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('bỏ kết quả liên hệ gửi contactResultId = null (hợp đồng: null = bỏ kết quả)', async () => {
    const user = userEvent.setup();
    renderForm(savedLog);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), '');
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(updateCareLog).toHaveBeenCalled());
    expect(updateCareLog.mock.calls[0][2]).toMatchObject({ contactResultId: null });
  });

  it('cờ ảnh bật: hiện ảnh đã đính kèm; gửi tập ảnh mong muốn; gỡ 1 ảnh cũ chỉ bỏ khỏi danh sách (KHÔNG gọi xóa file ở kho)', async () => {
    flags.isAttachmentsEnabled = true;
    const user = userEvent.setup();
    renderForm(savedLog);
    expect(screen.getByRole('img', { name: 'Ảnh 1' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ảnh 2' })).toBeInTheDocument();
    expect(screen.getByText(/Đã chọn 2\/5 ảnh/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Xóa ảnh 1' }));
    expect(deleteCareLogAttachment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(updateCareLog).toHaveBeenCalled());
    expect(updateCareLog.mock.calls[0][2]).toMatchObject({ attachmentIds: ['att-2'] });
  });

  it('cờ ảnh bật, không đổi ảnh: gửi nguyên tập ảnh cũ', async () => {
    flags.isAttachmentsEnabled = true;
    const user = userEvent.setup();
    renderForm(savedLog);
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(updateCareLog).toHaveBeenCalled());
    expect(updateCareLog.mock.calls[0][2]).toMatchObject({ attachmentIds: ['att-1', 'att-2'] });
  });

  it('lưu thất bại (vd 403 không phải tác giả): giữ form mở và nội dung đang sửa, không đóng', async () => {
    updateCareLog.mockResolvedValue({ ok: false, error: { statusCode: 403, errorCode: 'CARE_LOG_FORBIDDEN', message: 'Bạn không có quyền sửa nhật ký này' } });
    const user = userEvent.setup();
    renderForm(savedLog);
    await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(updateCareLog).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Đã gọi tư vấn lần 1');
  });

  it('xóa hết nội dung thì không lưu được (nút Lưu thay đổi bị khóa)', () => {
    renderForm(savedLog);
    fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  });

  it('Hủy khi đang sửa: đóng form, không gọi updateCareLog, không xóa ảnh đã lưu', async () => {
    flags.isAttachmentsEnabled = true;
    const user = userEvent.setup();
    renderForm(savedLog);
    await user.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(updateCareLog).not.toHaveBeenCalled();
    expect(deleteCareLogAttachment).not.toHaveBeenCalled();
  });
});
