/**
 * Trạng thái mở/đóng form ghi chú chăm sóc của màn "Chi tiết khách hàng" (PT-020, PT-022), dùng chung desktop + mobile.
 * Form KHÔNG hiện sẵn: chỉ mở khi bấm "Ghi chú" (thêm mới) hoặc "Sửa" trên một nhật ký (mở lại với dữ liệu cũ).
 * Trạng thái gắn với 1 khách: đổi sang khách khác (cùng component) thì tự đóng, không mang nháp sang hồ sơ khác.
 *
 * Chống mất bản nháp: khi form đang mở mà còn thay đổi CHƯA LƯU (`isDirty`, do form báo qua `reportGuard`), mọi yêu cầu đổi sang
 * form khác (bấm "Sửa" nhật ký khác, "Ghi chú" lúc đang sửa) hoặc Hủy/X đều được giữ ở `pending` để hộp xác nhận hỏi lại;
 * đang lưu (`isSaving`) thì bỏ qua yêu cầu (tránh gỡ form giữa chừng khi ảnh đang được gắn vào nhật ký).
 */
import { useCallback, useRef, useState } from 'react';
import type { CareLogView } from '@crm/api';

export type NoteComposerState = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; log: CareLogView };

const CLOSED: NoteComposerState = { kind: 'closed' };

/** Form báo lên: còn thay đổi chưa lưu / đang lưu. */
export interface NoteComposerGuard {
  isDirty: boolean;
  isSaving: boolean;
}

const IDLE_GUARD: NoteComposerGuard = { isDirty: false, isSaving: false };

export interface NoteComposer {
  state: NoteComposerState;
  /** Yêu cầu đang chờ người dùng xác nhận bỏ bản nháp (null = không có). */
  pending: NoteComposerState | null;
  openCreate: () => void;
  openEdit: (log: CareLogView) => void;
  /** Đóng NGAY (dùng sau khi lưu xong). */
  close: () => void;
  /** Người dùng bấm Hủy/X: còn thay đổi chưa lưu thì hỏi lại, không thì đóng. */
  requestClose: () => void;
  /** Đồng ý bỏ bản nháp: thực hiện yêu cầu đang chờ. */
  confirmPending: () => void;
  /** Giữ lại bản nháp: bỏ yêu cầu đang chờ. */
  cancelPending: () => void;
  /** Form gọi mỗi khi `isDirty`/`isSaving` đổi. */
  reportGuard: (guard: NoteComposerGuard) => void;
}

interface OwnedState {
  customerId: string;
  state: NoteComposerState;
  pending: NoteComposerState | null;
}

/** Cùng 1 form: cùng loại và (với sửa) cùng nhật ký -> mở lại không được reset bản nháp đang nhập. */
const isSameForm = (current: NoteComposerState, target: NoteComposerState): boolean =>
  current.kind === target.kind && (current.kind !== 'edit' || target.kind !== 'edit' || current.log.id === target.log.id);

export interface NoteComposerOptions {
  /** Trạng thái lúc dựng (mặc định đóng). Hộp thoại ghi chú ở các màn khác dựng sẵn `{ kind: 'create' }`. */
  initialState?: NoteComposerState;
  /** Gọi khi form được ĐÓNG (sau lưu, Hủy/X, hoặc xác nhận bỏ nháp) — để chỗ chứa (hộp thoại/bottom sheet) tự gỡ mình. */
  onClosed?: () => void;
}

export const useNoteComposer = (customerId: string, options: NoteComposerOptions = {}): NoteComposer => {
  const [owned, setOwned] = useState<OwnedState>({ customerId, state: options.initialState ?? CLOSED, pending: null });
  const guardRef = useRef<NoteComposerGuard>(IDLE_GUARD);
  // Giữ callback mới nhất mà không làm đổi danh tính các hàm trả về.
  const onClosedRef = useRef(options.onClosed);
  onClosedRef.current = options.onClosed;
  const isCurrent = owned.customerId === customerId;
  const state = isCurrent ? owned.state : CLOSED;
  const pending = isCurrent ? owned.pending : null;

  const apply = useCallback(
    (target: NoteComposerState) => {
      guardRef.current = IDLE_GUARD;
      setOwned({ customerId, state: target, pending: null });
      if (target.kind === 'closed') onClosedRef.current?.();
    },
    [customerId],
  );

  const request = useCallback(
    (target: NoteComposerState) => {
      if (state.kind !== 'closed' && isSameForm(state, target)) return; // đã mở đúng form này: giữ nguyên bản nháp
      if (state.kind !== 'closed') {
        if (guardRef.current.isSaving) return;
        if (guardRef.current.isDirty) {
          setOwned({ customerId, state, pending: target });
          return;
        }
      }
      apply(target);
    },
    [apply, customerId, state],
  );

  const openCreate = useCallback(() => request({ kind: 'create' }), [request]);
  const openEdit = useCallback((log: CareLogView) => request({ kind: 'edit', log }), [request]);
  const close = useCallback(() => apply(CLOSED), [apply]);
  const requestClose = useCallback(() => request(CLOSED), [request]);
  const confirmPending = useCallback(() => {
    if (pending) apply(pending);
  }, [apply, pending]);
  const cancelPending = useCallback(() => setOwned({ customerId, state, pending: null }), [customerId, state]);
  const reportGuard = useCallback((guard: NoteComposerGuard) => {
    guardRef.current = guard;
  }, []);

  return { state, pending, openCreate, openEdit, close, requestClose, confirmPending, cancelPending, reportGuard };
};
