import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import { CareLogDialog, type CareLogDialogVariant } from './CareLogDialog';

// Cờ ảnh đọc lúc render; mặc định TẮT như production.
const flags = vi.hoisted(() => ({ isAttachmentsEnabled: false }));
vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: flags }));

const createCareLog = vi.fn();
const catalogs = vi.hoisted(() => ({
  contactResults: [{ id: 'r1', label: 'Quan tâm', isActive: true, order: 1, suggestionText: 'Gửi bảng giá', suggestedFollowUpDays: 2 }],
}));

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({ createCareLog, deleteCareLogAttachment: vi.fn() }), useCatalogs: () => ({ catalogs }) };
});

const customer = {
  id: 'c1',
  fullName: 'Nguyễn Văn A',
  phoneMasked: '090****123',
  version: 1,
  status: { id: 's', label: 'Mới' },
  criteria: {},
  careTeam: [{ role: 'PRIMARY', user: { id: 'u-primary' } }],
} as unknown as CustomerDetail;

const onClose = vi.fn();

const renderDialog = (variant: CareLogDialogVariant) => {
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  return render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CareLogDialog customer={customer} variant={variant} onClose={onClose} />
      </CrmProvider>
    </MemoryRouter>,
  );
};

const contentBox = () => screen.getByRole('textbox', { name: /Nội dung trao đổi/ });

beforeEach(() => {
  flags.isAttachmentsEnabled = false;
  onClose.mockReset();
  createCareLog.mockReset();
  createCareLog.mockResolvedValue({ ok: true, data: { id: 'log-1' } });
});

describe.each<CareLogDialogVariant>(['dialog', 'sheet'])('CareLogDialog (%s): form ĐẦY ĐỦ như tab Nhật ký', (variant) => {
  it('có role=dialog được đặt tên và hiện đủ trường: nội dung, kênh liên hệ, kết quả, nhắc việc tiếp theo', () => {
    renderDialog(variant);
    expect(screen.getByRole('dialog', { name: /Ghi chú chăm sóc/ })).toBeInTheDocument();
    expect(screen.getAllByText(/090\*{4}123/).length).toBeGreaterThan(0);
    expect(contentBox()).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Kênh liên hệ' })).toHaveValue('CALL');
    expect(screen.getByRole('combobox', { name: 'Kết quả liên hệ' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Nhắc việc tiếp theo' })).toBeInTheDocument();
    // Cờ ảnh tắt: không có khung ảnh.
    expect(screen.queryByText('Thêm ảnh')).toBeNull();
  });

  it('cờ ảnh bật: hiện khung "Thêm ảnh"', () => {
    flags.isAttachmentsEnabled = true;
    renderDialog(variant);
    expect(screen.getByText('Thêm ảnh')).toBeInTheDocument();
  });

  it('lưu: gửi kênh đã chọn + việc tiếp theo, hết bận thì đóng hộp', async () => {
    renderDialog(variant);
    fireEvent.change(contentBox(), { target: { value: 'Khách hẹn chiều nay' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Kênh liên hệ' }), { target: { value: 'ZALO' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Việc cần làm tiếp theo' }), { target: { value: 'Gửi bảng giá' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(createCareLog).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ content: 'Khách hẹn chiều nay', contactChannel: 'ZALO', nextAction: expect.objectContaining({ suggestion: 'Gửi bảng giá' }) }),
      'u-primary',
    );
  });

  it('lưu lỗi: KHÔNG đóng hộp, giữ nguyên nội dung đã nhập', async () => {
    createCareLog.mockResolvedValue({ ok: false, error: { code: 'X', message: 'Lỗi mạng' } });
    renderDialog(variant);
    fireEvent.change(contentBox(), { target: { value: 'Nội dung quan trọng' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu nhật ký' }));
    await waitFor(() => expect(createCareLog).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(contentBox()).toHaveValue('Nội dung quan trọng');
  });

  it('Hủy khi form còn trống: đóng ngay, không hỏi', () => {
    renderDialog(variant);
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Bỏ thay đổi chưa lưu?')).toBeNull();
  });

  it('Hủy khi còn bản nháp: hỏi lại; "Tiếp tục nhập" giữ nháp, "Bỏ thay đổi" đóng và không lưu', () => {
    renderDialog(variant);
    fireEvent.change(contentBox(), { target: { value: 'Nháp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(screen.getByText('Bỏ thay đổi chưa lưu?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    expect(screen.queryByText('Bỏ thay đổi chưa lưu?')).toBeNull();
    expect(contentBox()).toHaveValue('Nháp');
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createCareLog).not.toHaveBeenCalled();
  });

  it('Esc khi còn bản nháp: hỏi lại (không đóng thẳng); Esc lần nữa chỉ đóng hộp hỏi, giữ nháp', () => {
    renderDialog(variant);
    fireEvent.change(contentBox(), { target: { value: 'Nháp' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Bỏ thay đổi chưa lưu?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Bỏ thay đổi chưa lưu?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(contentBox()).toHaveValue('Nháp');
  });

  it('Esc khi form trống: đóng ngay', () => {
    renderDialog(variant);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CareLogDialog: nút đóng của vỏ hộp thoại', () => {
  it('web: nút "Đóng hộp ghi chú" có tên truy cập và đi qua bước hỏi nháp', () => {
    renderDialog('dialog');
    fireEvent.change(contentBox(), { target: { value: 'Nháp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng hộp ghi chú' }));
    expect(screen.getByText('Bỏ thay đổi chưa lưu?')).toBeInTheDocument();
  });

  it('app: nút "Đóng" của bottom sheet đi qua bước hỏi nháp', () => {
    renderDialog('sheet');
    fireEvent.change(contentBox(), { target: { value: 'Nháp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.getByText('Bỏ thay đổi chưa lưu?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('CareLogDialog: khóa cuộn trang nền và trợ năng bàn phím', () => {
  it.each<CareLogDialogVariant>(['dialog', 'sheet'])('(%s) khóa cuộn body khi mở, vẫn khóa sau "Tiếp tục nhập", nhả khi đóng', (variant) => {
    document.body.style.overflow = '';
    const { unmount } = renderDialog(variant);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.change(contentBox(), { target: { value: 'Nháp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    // Hộp "Bỏ thay đổi?" là Modal lồng: đóng nó không được làm mất khóa cuộn của hộp ghi chú.
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it.each<CareLogDialogVariant>(['dialog', 'sheet'])('(%s) mở ra thì con trỏ nằm ở ô nội dung', (variant) => {
    renderDialog(variant);
    expect(contentBox()).toHaveFocus();
  });

  it('web: Tab ở nút cuối xoay về nút đầu (nút đóng), Shift+Tab xoay ngược — không rời hộp', async () => {
    const user = userEvent.setup();
    renderDialog('dialog');
    // Chưa có nội dung -> nút Lưu bị khóa; nút cuối nhận được tiêu điểm là "Hủy".
    expect(screen.getByRole('button', { name: 'Lưu nhật ký' })).toBeDisabled();
    const cancel = screen.getByRole('button', { name: 'Hủy' });
    cancel.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Đóng hộp ghi chú' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it('app: Tab ở nút cuối xoay về ô nội dung (vùng form), Shift+Tab ở ô nội dung xoay về nút cuối', async () => {
    const user = userEvent.setup();
    renderDialog('sheet');
    const cancel = screen.getByRole('button', { name: 'Hủy' });
    cancel.focus();
    await user.tab();
    expect(contentBox()).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it('web: đóng hộp trả tiêu điểm về nút đã mở', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = renderDialog('dialog');
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
