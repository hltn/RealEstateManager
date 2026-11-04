import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const renderComposer = (state: NoteComposerState, pending: NoteComposerState | null = null, variant: 'desktop' | 'mobile' = 'mobile', layout?: 'card' | 'dialog') => {
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
  const ui = (focusSignal?: number) => (
    <MemoryRouter>
      <CrmProvider store={store}>
        <CareLogComposer customer={customer} variant={variant} layout={layout} composer={composer} focusSignal={focusSignal} />
      </CrmProvider>
    </MemoryRouter>
  );
  const view = render(ui());
  return Object.assign(composer, { container: view.container, setFocusSignal: (signal: number) => view.rerender(ui(signal)) });
};

describe('CareLogComposer (PT-020, PT-028): form chỉ hiện khi đã mở, trạng thái đóng không có nút riêng', () => {
  it.each(['mobile', 'desktop'] as const)('đóng (%s): không dựng gì (không nút "Ghi chú", không form, không ô nhập); nút mở form nằm ở thanh đáy / đầu thẻ Nhật ký', (variant) => {
    const composer = renderComposer({ kind: 'closed' }, null, variant);
    expect(composer.container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(composer.openCreate).not.toHaveBeenCalled();
  });

  it('mở thêm mới: hiện form đầy đủ "Thêm nhật ký chăm sóc", không có nút "Ghi chú"', () => {
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

describe('CareLogComposer (PT-028): focusSignal đưa form đang mở vào vùng nhìn thấy + focus lại, không reset nháp', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });

  it('mở form: cuộn + focus 1 lần; đổi focusSignal: cuộn + focus lại, nội dung đã gõ còn nguyên; render lại cùng giá trị thì KHÔNG cuộn thêm', () => {
    const composer = renderComposer({ kind: 'create' });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const textbox = screen.getByRole('textbox', { name: /Nội dung trao đổi/ });
    fireEvent.change(textbox, { target: { value: 'Nháp' } });
    (document.activeElement as HTMLElement).blur();
    expect(textbox).not.toHaveFocus();

    composer.setFocusSignal(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(textbox).toHaveFocus();
    expect(textbox).toHaveValue('Nháp');

    composer.setFocusSignal(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('trong hộp thoại (layout "dialog") focusSignal không cuộn/focus: vỏ hộp thoại tự lo tiêu điểm', () => {
    const composer = renderComposer({ kind: 'create' }, null, 'mobile', 'dialog');
    composer.setFocusSignal(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
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
