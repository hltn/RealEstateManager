/** FR-47: ô "Kết quả liên hệ" của CallModal lấy từ danh mục DB (cùng hook `useCatalogs` với form nhật ký), không còn 5 chuỗi cứng. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallModal, type ContactTarget } from './CallModal';

// FR-47: cờ gọi trong ứng dụng TẮT (như production) — CallModal không được phụ thuộc cờ để hiện danh mục DB.
vi.mock('@crm/config/featureFlags', () => ({ CRM_FEATURE_FLAGS: { isInAppCallEnabled: false } }));

interface CatalogState {
  catalogs: { contactResults: unknown[] };
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

const catalogState = vi.hoisted(() => ({ value: {} as CatalogState }));
vi.mock('@crm/api', () => ({ useCatalogs: () => catalogState.value }));

const result = (code: string, label: string, order: number, isActive = true) => ({ id: code, label, order, isActive, suggestionText: '', suggestedFollowUpDays: null });
const refetch = vi.fn();

const setCatalog = (patch: Partial<Omit<CatalogState, 'catalogs'>> & { contactResults?: unknown[] }) => {
  const { contactResults = [], ...rest } = patch;
  catalogState.value = { catalogs: { contactResults }, isLoading: false, isError: false, refetch, ...rest };
};

const customer: ContactTarget = { name: 'Nguyễn Văn A', phone: '0901234567', preferredSalutation: 'anh A', interestedProjects: [] };
const onSaveLog = vi.fn();
const onClose = vi.fn();

const renderModal = () => render(<CallModal customer={customer} onClose={onClose} onSaveLog={onSaveLog} />);
const select = () => screen.getByRole('combobox', { name: 'Kết quả liên hệ' });
const endCall = () => fireEvent.click(screen.getByRole('button', { name: /Kết thúc cuộc gọi/ }));

beforeEach(() => {
  onSaveLog.mockReset();
  onClose.mockReset();
  refetch.mockReset();
  setCatalog({ contactResults: [result('PRICE_QUOTE', 'Quan tâm giá', 2), result('SITE_VISIT', 'Hẹn xem nhà', 1), result('HIDDEN_ONE', 'Mục đã ẩn', 3, false)] });
});

describe('CallModal: ô Kết quả liên hệ theo danh mục DB (FR-47)', () => {
  it('FR-47: hiện đúng mục đang bật theo thứ tự cấu hình, giá trị option là code', () => {
    renderModal();
    const options = Array.from(select().querySelectorAll('option'));
    expect(options.map((option) => option.textContent)).toEqual(['Chưa chọn kết quả', 'Hẹn xem nhà', 'Quan tâm giá']);
    expect(options.map((option) => option.value)).toEqual(['', 'SITE_VISIT', 'PRICE_QUOTE']);
  });

  it('FR-47: mục bị ẩn và 5 chuỗi cứng cũ không còn xuất hiện', () => {
    renderModal();
    expect(screen.queryByRole('option', { name: 'Mục đã ẩn' })).toBeNull();
    expect(screen.queryByRole('option', { name: /Khách không có nhu cầu/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Máy bận/ })).toBeNull();
  });

  it('FR-47: đúng cả khi cờ isInAppCallEnabled tắt (modal không đọc cờ)', () => {
    renderModal();
    expect(select()).toBeEnabled();
    expect(screen.getByRole('option', { name: 'Hẹn xem nhà' })).toBeInTheDocument();
  });

  it('FR-47: đang tải danh mục -> khung chờ (aria-busy), không có ô chọn', () => {
    setCatalog({ isLoading: true });
    renderModal();
    expect(screen.getByRole('status', { name: /Đang tải danh mục/ })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('combobox', { name: 'Kết quả liên hệ' })).toBeNull();
  });

  it('FR-47: lỗi tải -> báo lỗi rõ + "Thử lại" gọi refetch, ô chọn bị khóa', () => {
    setCatalog({ isError: true });
    renderModal();
    expect(screen.getByRole('alert')).toHaveTextContent('Không tải được danh mục kết quả liên hệ');
    expect(select()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('FR-47: lỗi một danh mục khác nhưng danh mục kết quả đã có -> vẫn hiện ô chọn, không báo lỗi', () => {
    setCatalog({ isError: true, contactResults: [result('PRICE_QUOTE', 'Quan tâm giá', 1)] });
    renderModal();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(select()).toBeEnabled();
  });

  it('FR-47: lưu gửi code đã chọn; ghi chú trống thì nội dung mặc định kèm nhãn mục', () => {
    renderModal();
    fireEvent.change(select(), { target: { value: 'SITE_VISIT' } });
    endCall();
    fireEvent.click(screen.getByRole('button', { name: /Lưu vào nhật ký/ }));
    expect(onSaveLog).toHaveBeenCalledWith({ note: 'Cuộc gọi 00:00 với Nguyễn Văn A: Hẹn xem nhà', contactResultId: 'SITE_VISIT' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('FR-47: không chọn gì -> contactResultId null, ghi chú người dùng giữ nguyên', () => {
    renderModal();
    fireEvent.change(screen.getByRole('textbox', { name: /Ghi chú nhanh/ }), { target: { value: ' Khách hẹn gọi lại ' } });
    endCall();
    fireEvent.click(screen.getByRole('button', { name: /Lưu vào nhật ký/ }));
    expect(onSaveLog).toHaveBeenCalledWith({ note: 'Khách hẹn gọi lại', contactResultId: null });
  });

  it('FR-47: lỗi tải danh mục vẫn lưu được nhật ký (không mất ghi chú), không gắn kết quả', () => {
    setCatalog({ isError: true });
    renderModal();
    endCall();
    fireEvent.click(screen.getByRole('button', { name: /Lưu vào nhật ký/ }));
    expect(onSaveLog).toHaveBeenCalledWith({ note: 'Cuộc gọi 00:00 với Nguyễn Văn A', contactResultId: null });
  });
});
