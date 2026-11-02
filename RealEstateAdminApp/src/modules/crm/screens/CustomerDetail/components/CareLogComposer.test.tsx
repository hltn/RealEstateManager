import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { CareLogView, CustomerDetail } from '@crm/api';
import { CrmProvider } from '@crm/store/CrmProvider';
import { createCrmStore, createSeedDataState } from '@crm/store/crmStore';
import { FIXED_NOW } from '@crm/test/fixtures';
import type { NoteComposer, NoteComposerState } from '../useNoteComposer';
import { CareLogComposer } from './CareLogComposer';

vi.mock('@crm/api', async () => {
  const real = await vi.importActual<typeof import('@crm/api')>('@crm/api');
  return { ...real, useCrmApi: () => ({}), useCatalogs: () => ({ catalogs: { contactResults: [] } }) };
});

const customer = { id: 'c1', version: 1, status: { id: 's', label: 'Mới' }, criteria: {}, careTeam: [] } as unknown as CustomerDetail;
const log = { id: 'l1', customerId: 'c1', content: 'Nội dung cũ', contactChannel: 'CALL', contactResult: null, images: [], attachmentIds: [] } as unknown as CareLogView;

const renderComposer = (state: NoteComposerState, pending: NoteComposerState | null = null) => {
  const composer: NoteComposer = {
    state,
    pending,
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    close: vi.fn(),
    requestClose: vi.fn(),
    confirmPending: vi.fn(),
    cancelPending: vi.fn(),
    reportGuard: vi.fn(),
  };
  const store = createCrmStore({ initialData: createSeedDataState(FIXED_NOW), shouldPersist: false });
  render(
    <MemoryRouter>
      <CrmProvider store={store}>
        <CareLogComposer customer={customer} variant="mobile" composer={composer} />
      </CrmProvider>
    </MemoryRouter>,
  );
  return composer;
};

describe('CareLogComposer (PT-020): form chỉ hiện khi bấm nút "Ghi chú"', () => {
  it('đóng: chỉ có nút "Ghi chú", KHÔNG có ô nhập/biểu mẫu nào; bấm nút gọi openCreate', () => {
    const composer = renderComposer({ kind: 'closed' });
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ghi chú' }));
    expect(composer.openCreate).toHaveBeenCalledTimes(1);
  });

  it('mở thêm mới: hiện form đầy đủ "Thêm nhật ký chăm sóc" và ẩn nút "Ghi chú"', () => {
    renderComposer({ kind: 'create' });
    expect(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ghi chú' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Kênh liên hệ' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Kết quả liên hệ' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Nhắc việc tiếp theo' })).toBeInTheDocument();
  });

  it('mở sửa: form điền sẵn nội dung cũ; Hủy gọi requestClose (có hỏi lại nếu còn thay đổi), KHÔNG đóng thẳng', () => {
    const composer = renderComposer({ kind: 'edit', log });
    expect(screen.getByRole('form', { name: 'Sửa nhật ký chăm sóc' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Nội dung trao đổi/ })).toHaveValue('Nội dung cũ');
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(composer.requestClose).toHaveBeenCalledTimes(1);
    expect(composer.close).not.toHaveBeenCalled();
  });

  it('form báo trạng thái "chưa lưu" lên composer: gõ nội dung -> isDirty = true', () => {
    const composer = renderComposer({ kind: 'create' });
    expect(composer.reportGuard).toHaveBeenLastCalledWith({ isDirty: false, isSaving: false });
    fireEvent.change(screen.getByRole('textbox', { name: /Nội dung trao đổi/ }), { target: { value: 'Nháp' } });
    expect(composer.reportGuard).toHaveBeenLastCalledWith({ isDirty: true, isSaving: false });
  });
});

describe('CareLogComposer: hỏi lại trước khi bỏ bản nháp (chống mất dữ liệu âm thầm)', () => {
  it('không có yêu cầu chờ: không hiện hộp xác nhận', () => {
    renderComposer({ kind: 'create' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('có yêu cầu chờ: hiện hộp "Bỏ thay đổi chưa lưu?"; "Tiếp tục nhập" -> cancelPending, "Bỏ thay đổi" -> confirmPending; form vẫn còn trong lúc hỏi', () => {
    const composer = renderComposer({ kind: 'create' }, { kind: 'edit', log });
    expect(screen.getByRole('dialog')).toHaveTextContent('Bỏ thay đổi chưa lưu?');
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục nhập' }));
    expect(composer.cancelPending).toHaveBeenCalledTimes(1);
    expect(composer.confirmPending).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ thay đổi' }));
    expect(composer.confirmPending).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('form', { name: 'Thêm nhật ký chăm sóc' })).toBeInTheDocument();
  });
});
