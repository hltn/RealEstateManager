import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CareLogView } from '@crm/api';
import { useNoteComposer } from './useNoteComposer';

const log = { id: 'l1' } as CareLogView;

describe('useNoteComposer (PT-020, PT-022): form ghi chú không hiện sẵn', () => {
  it('mặc định ĐÓNG', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    expect(result.current.state).toEqual({ kind: 'closed' });
  });

  it('openCreate -> thêm mới; openEdit -> sửa đúng nhật ký; close -> đóng', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    act(() => result.current.openCreate());
    expect(result.current.state).toEqual({ kind: 'create' });
    act(() => result.current.openEdit(log));
    expect(result.current.state).toEqual({ kind: 'edit', log });
    act(() => result.current.close());
    expect(result.current.state).toEqual({ kind: 'closed' });
  });

  it('đổi sang khách khác (cùng component) thì tự đóng, không mang form đang mở sang hồ sơ khác', () => {
    const { result, rerender } = renderHook(({ customerId }) => useNoteComposer(customerId), { initialProps: { customerId: 'c1' } });
    act(() => result.current.openCreate());
    rerender({ customerId: 'c2' });
    expect(result.current.state).toEqual({ kind: 'closed' });
    act(() => result.current.openEdit(log));
    expect(result.current.state).toEqual({ kind: 'edit', log });
  });
});

describe('useNoteComposer: không làm mất bản nháp âm thầm', () => {
  const otherLog = { id: 'l2' } as CareLogView;
  const dirty = { isDirty: true, isSaving: false };

  it('form sạch (chưa nhập gì): bấm "Sửa" nhật ký khác thì đổi thẳng, không hỏi', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    act(() => result.current.openCreate());
    act(() => result.current.reportGuard({ isDirty: false, isSaving: false }));
    act(() => result.current.openEdit(log));
    expect(result.current.state).toEqual({ kind: 'edit', log });
    expect(result.current.pending).toBeNull();
  });

  it('form đang có bản nháp: bấm "Sửa" nhật ký khác -> GIỮ form cũ và đưa yêu cầu vào pending', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    act(() => result.current.openCreate());
    act(() => result.current.reportGuard(dirty));
    act(() => result.current.openEdit(log));
    expect(result.current.state).toEqual({ kind: 'create' });
    expect(result.current.pending).toEqual({ kind: 'edit', log });
  });

  it('từ chối: giữ nguyên form cũ; xác nhận bỏ: chuyển sang form mới và xóa pending', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    act(() => result.current.openCreate());
    act(() => result.current.reportGuard(dirty));
    act(() => result.current.openEdit(log));
    act(() => result.current.cancelPending());
    expect(result.current.state).toEqual({ kind: 'create' });
    expect(result.current.pending).toBeNull();
    act(() => result.current.openEdit(log));
    act(() => result.current.confirmPending());
    expect(result.current.state).toEqual({ kind: 'edit', log });
    expect(result.current.pending).toBeNull();
  });

  it('sau khi đổi form, cờ "chưa lưu" cũ không dính sang form mới (form mới chưa báo gì thì đổi tiếp không hỏi)', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    act(() => result.current.openCreate());
    act(() => result.current.reportGuard(dirty));
    act(() => result.current.openEdit(log));
    act(() => result.current.confirmPending());
    act(() => result.current.openEdit(otherLog));
    expect(result.current.state).toEqual({ kind: 'edit', log: otherLog });
    expect(result.current.pending).toBeNull();
  });

  it('bấm lại đúng form đang mở (Ghi chú khi đang thêm mới, Sửa đúng nhật ký đang sửa): giữ nguyên, không hỏi, không reset', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    act(() => result.current.openCreate());
    act(() => result.current.reportGuard(dirty));
    const before = result.current.state;
    act(() => result.current.openCreate());
    expect(result.current.state).toBe(before);
    expect(result.current.pending).toBeNull();
    act(() => result.current.close());
    act(() => result.current.openEdit(log));
    act(() => result.current.reportGuard(dirty));
    act(() => result.current.openEdit({ ...log }));
    expect(result.current.pending).toBeNull();
    expect(result.current.state).toEqual({ kind: 'edit', log });
  });

  it('đang lưu: bỏ qua yêu cầu đổi form (không hỏi, không đổi) để không gỡ form giữa lúc gắn ảnh', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    act(() => result.current.openCreate());
    act(() => result.current.reportGuard({ isDirty: true, isSaving: true }));
    act(() => result.current.openEdit(log));
    expect(result.current.state).toEqual({ kind: 'create' });
    expect(result.current.pending).toBeNull();
  });

  it('Hủy/X (requestClose): sạch -> đóng ngay; có bản nháp -> hỏi lại; close() luôn đóng thẳng (sau khi lưu xong)', () => {
    const { result } = renderHook(() => useNoteComposer('c1'));
    act(() => result.current.openCreate());
    act(() => result.current.requestClose());
    expect(result.current.state).toEqual({ kind: 'closed' });
    act(() => result.current.openCreate());
    act(() => result.current.reportGuard(dirty));
    act(() => result.current.requestClose());
    expect(result.current.state).toEqual({ kind: 'create' });
    expect(result.current.pending).toEqual({ kind: 'closed' });
    act(() => result.current.close());
    expect(result.current.state).toEqual({ kind: 'closed' });
    expect(result.current.pending).toBeNull();
  });

  it('đổi sang khách khác: yêu cầu đang chờ cũng bị bỏ', () => {
    const { result, rerender } = renderHook(({ customerId }) => useNoteComposer(customerId), { initialProps: { customerId: 'c1' } });
    act(() => result.current.openCreate());
    act(() => result.current.reportGuard(dirty));
    act(() => result.current.openEdit(log));
    rerender({ customerId: 'c2' });
    expect(result.current.state).toEqual({ kind: 'closed' });
    expect(result.current.pending).toBeNull();
  });
});

describe('useNoteComposer: dùng trong hộp thoại ở màn khác (initialState + onClosed)', () => {
  const dirty = { isDirty: true, isSaving: false };

  it('initialState dựng sẵn form thêm mới', () => {
    const { result } = renderHook(() => useNoteComposer('c1', { initialState: { kind: 'create' } }));
    expect(result.current.state).toEqual({ kind: 'create' });
  });

  it('onClosed chỉ gọi khi form ĐÓNG: sau lưu (close), Hủy khi sạch, xác nhận bỏ nháp; KHÔNG gọi khi hỏi lại/giữ nháp hay đổi sang form khác', () => {
    const onClosed = vi.fn();
    const { result } = renderHook(() => useNoteComposer('c1', { initialState: { kind: 'create' }, onClosed }));
    act(() => result.current.reportGuard(dirty));
    act(() => result.current.requestClose());
    expect(onClosed).not.toHaveBeenCalled();
    act(() => result.current.cancelPending());
    expect(onClosed).not.toHaveBeenCalled();
    act(() => result.current.requestClose());
    act(() => result.current.confirmPending());
    expect(onClosed).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useNoteComposer('c1', { initialState: { kind: 'create' }, onClosed }));
    act(() => second.result.current.requestClose()); // sạch -> đóng ngay
    expect(onClosed).toHaveBeenCalledTimes(2);
    const third = renderHook(() => useNoteComposer('c1', { initialState: { kind: 'create' }, onClosed }));
    act(() => third.result.current.close()); // sau khi lưu xong
    expect(onClosed).toHaveBeenCalledTimes(3);
    act(() => third.result.current.openEdit(log));
    expect(onClosed).toHaveBeenCalledTimes(3);
  });
});
