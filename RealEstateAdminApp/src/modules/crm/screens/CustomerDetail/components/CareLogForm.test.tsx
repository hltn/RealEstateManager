import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const renderForm = (editingLog?: CareLogView) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CareLogForm customer={customer} variant="desktop" editingLog={editingLog} onClose={onClose} />
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

describe('G1: khung tải ảnh trong form ghi nhật ký theo cờ VITE_FEATURE_CRM_ATTACHMENTS', () => {
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
  it('đủ nội dung, kênh liên hệ, kết quả liên hệ, nhắc việc tiếp theo (việc + thời điểm + lịch hẹn) và ảnh (cờ bật)', () => {
    flags.isAttachmentsEnabled = true;
    renderForm();
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Kênh liên hệ' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Kết quả liên hệ' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'Nhắc việc tiếp theo' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Việc cần làm tiếp theo' })).toBeVisible();
    expect(screen.getByLabelText('Thời điểm nhắc')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: /Tạo lịch hẹn/ })).toBeVisible();
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

  it('chọn kết quả liên hệ có gợi ý: điền sẵn việc tiếp theo và mốc nhắc (khi thêm mới)', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Kết quả liên hệ' }), 'r1');
    expect(screen.getByRole('textbox', { name: 'Việc cần làm tiếp theo' })).toHaveValue('Gửi bảng giá');
    expect((screen.getByLabelText('Thời điểm nhắc') as HTMLInputElement).value).not.toBe('');
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
