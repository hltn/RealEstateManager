import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ContactResult } from '@crm/types/crm';
import { CatalogSection } from './CatalogSection';

const api = { createCatalogItem: vi.fn(), updateCatalogItem: vi.fn() };
const showToast = vi.fn();
let contactResults: ContactResult[] = [];

vi.mock('@crm/api', () => ({
  useCatalogs: () => ({ catalogs: { statuses: [], leadSources: [], areas: [], projects: [], tags: [], contactResults } }),
  useCrmApi: () => api,
}));
vi.mock('@crm/store', () => ({ useCrmActions: () => ({ showToast }) }));

const make = (patch: Partial<ContactResult>): ContactResult => ({ id: 'PRICE_QUOTE', label: 'Đã báo giá', suggestedFollowUpDays: 2, suggestionText: 'Gọi hỏi phản hồi', order: 1, isActive: true, ...patch });
const renderSection = () => render(<CatalogSection kind="contactResults" description="Mô tả" />);
const form = () => screen.getByRole('form', { name: /danh mục/ });
const type = (label: string | RegExp, value: string) => fireEvent.change(within(form()).getByLabelText(label), { target: { value } });

describe('CatalogSection - Kết quả liên hệ (FR-39)', () => {
  beforeEach(() => {
    api.createCatalogItem.mockReset().mockResolvedValue({ ok: true, data: {} });
    api.updateCatalogItem.mockReset().mockResolvedValue({ ok: true, data: {} });
    showToast.mockReset();
    contactResults = [make({}), make({ id: 'NO_ANSWER', label: 'Không nghe máy', suggestedFollowUpDays: null, suggestionText: '', order: 2 }), make({ id: 'OLD', label: 'Cũ', order: 3, isActive: false })];
  });

  it('FR-39: liệt kê kết quả kèm tóm tắt gợi ý; mục ẩn có nhãn "Đã ẩn" và nút "Dùng lại"', () => {
    renderSection();
    const [quote, noAnswer, hidden] = screen.getAllByRole('listitem');
    expect(within(quote).getByText('Hẹn lại sau 2 ngày')).toBeInTheDocument();
    expect(within(quote).getByText('Gợi ý: Gọi hỏi phản hồi')).toBeInTheDocument();
    expect(within(noAnswer).getByText('Không gợi ý hẹn lại')).toBeInTheDocument();
    expect(within(hidden).getByText('Đã ẩn')).toBeInTheDocument();
    expect(within(hidden).getByRole('button', { name: 'Dùng lại Cũ' })).toBeInTheDocument();
  });

  it('FR-39: thêm mới gọi createCatalogItem("contact-results") với code, số ngày và lời gợi ý; báo thành công và đóng form', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    type(/^Tên/, 'Hẹn xem nhà');
    type('Gợi ý hẹn lại sau (ngày)', '3');
    type('Gợi ý việc tiếp theo', 'Chuẩn bị lịch xem');
    fireEvent.click(within(form()).getByRole('button', { name: 'Thêm' }));

    await waitFor(() => expect(api.createCatalogItem).toHaveBeenCalledWith('contact-results', { code: 'HEN_XEM_NHA', label: 'Hẹn xem nhà', order: 4, suggestedFollowUpDays: 3, suggestionText: 'Chuẩn bị lịch xem' }));
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã thêm mục mới' });
    await waitFor(() => expect(screen.queryByRole('form', { name: /danh mục/ })).not.toBeInTheDocument());
  });

  it('FR-39: sửa nạp sẵn giá trị cũ, xóa số ngày rồi gọi updateCatalogItem không kèm code', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Sửa Đã báo giá' }));
    expect(within(form()).getByLabelText('Gợi ý hẹn lại sau (ngày)')).toHaveValue(2);
    expect(within(form()).getByLabelText('Gợi ý việc tiếp theo')).toHaveValue('Gọi hỏi phản hồi');
    type('Gợi ý hẹn lại sau (ngày)', '');
    fireEvent.click(within(form()).getByRole('button', { name: 'Lưu' }));

    await waitFor(() => expect(api.updateCatalogItem).toHaveBeenCalledWith('contact-results', 'PRICE_QUOTE', { label: 'Đã báo giá', order: 1, isActive: true, suggestedFollowUpDays: null, suggestionText: 'Gọi hỏi phản hồi' }));
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã lưu thay đổi' });
  });

  it('FR-39: ẩn gửi isActive=false; dùng lại (khôi phục) gửi isActive=true; giữ nguyên gợi ý', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn Đã báo giá' }));
    await waitFor(() => expect(api.updateCatalogItem).toHaveBeenCalledWith('contact-results', 'PRICE_QUOTE', expect.objectContaining({ isActive: false, suggestedFollowUpDays: 2, suggestionText: 'Gọi hỏi phản hồi' })));
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã ẩn "Đã báo giá"' });

    fireEvent.click(screen.getByRole('button', { name: 'Dùng lại Cũ' }));
    await waitFor(() => expect(api.updateCatalogItem).toHaveBeenCalledWith('contact-results', 'OLD', expect.objectContaining({ isActive: true })));
    expect(showToast).toHaveBeenCalledWith({ title: 'Đã dùng lại "Cũ"' });
  });

  it('FR-39: số ngày sai bị chặn ở form bằng lỗi tiếng Việt, không gọi API', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    type(/^Tên/, 'Hẹn xem nhà');
    type('Gợi ý hẹn lại sau (ngày)', '400');
    fireEvent.click(within(form()).getByRole('button', { name: 'Thêm' }));
    expect(await within(form()).findByText(/số nguyên từ 0 đến 365/)).toBeInTheDocument();
    expect(api.createCatalogItem).not.toHaveBeenCalled();
  });

  it('FR-39: lỗi từ máy chủ (trùng mã) hiện trong form, form vẫn mở để sửa', async () => {
    api.createCatalogItem.mockResolvedValue({ ok: false, error: { statusCode: 409, errorCode: 'CATALOG_DUPLICATED', message: 'Mã hoặc tên đã tồn tại.' } });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Thêm' }));
    type(/^Tên/, 'Đã báo giá');
    fireEvent.click(within(form()).getByRole('button', { name: 'Thêm' }));
    expect(await within(form()).findByText('Mã hoặc tên đã tồn tại.')).toBeInTheDocument();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('FR-39: ẩn thất bại (không có form) báo lỗi bằng thông báo', async () => {
    api.updateCatalogItem.mockResolvedValue({ ok: false, error: { statusCode: 403, errorCode: 'INSUFFICIENT_ROLE', message: 'Bạn không có quyền thực hiện thao tác này.' } });
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Ẩn Đã báo giá' }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith({ type: 'error', title: 'Bạn không có quyền thực hiện thao tác này.' }));
  });
});
