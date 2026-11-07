/**
 * Action creator phía GIAO DIỆN của module CRM: điều hướng, toast, modal, bộ lọc, đăng nhập giả.
 * Thao tác DỮ LIỆU (tạo/sửa khách, nhật ký, lịch hẹn...) KHÔNG nằm ở đây mà ở lớp truy cập dữ liệu `@crm/api`
 * (hàm đặt tên theo endpoint tài liệu 05) để sau này thay mock bằng API thật mà UI không đổi.
 */
import { createElement } from 'react';
import toast from 'react-hot-toast';
import { buildCreateAppointmentPath, buildCrmPath, type CreateAppointmentLink } from '@crm/routes';
import type { ActiveModal, CustomerFilters, ToastInput, ViewId } from '@crm/types/app';
import type { GalleryImage } from '@crm/types/crm';
import type { CrmAction, CrmState } from './crmReducer';

export const TOAST_DURATION_MS = 3500;

export interface CrmNavigateOptions {
  /** Thay mục lịch sử hiện tại (dùng sau khi lưu form: nút Back không quay về form trống). */
  shouldReplace?: boolean;
}

/** Cầu nối tới react-router — CrmProvider tạo từ `useNavigate()`. */
export interface CrmRouterBridge {
  navigateTo: (path: string, options?: CrmNavigateOptions) => void;
  /** Còn lịch sử trong app -> lùi 1 mục; mở thẳng URL -> thay bằng `fallbackPath` (mặc định: màn cha của màn hiện tại). */
  goBack: (fallbackPath?: string) => void;
}

export interface CrmActions {
  navigate: (view: ViewId, options?: CrmNavigateOptions) => void;
  goBack: () => void;
  /**
   * Như `goBack` nhưng khi mở thẳng URL (không có lịch sử trong app) thì về `fallbackPath` (thay mục lịch sử hiện tại).
   * Dùng cho nút Hủy/Quay lại cần về đúng màn bắt đầu mà Back không làm lịch sử bị trùng mục.
   */
  goBackTo: (fallbackPath: string) => void;
  /** Chọn khách; mặc định mở luôn màn chi tiết. */
  selectCustomer: (customerId: string, options?: { shouldOpenDetail?: boolean } & CrmNavigateOptions) => void;
  /**
   * Mở màn tạo lịch hẹn; `customerId` = khách chọn sẵn và khóa (từ chi tiết khách), `projectId` = dự án chọn sẵn (từ màn Dự án).
   * Không truyền = mở trống (từ danh sách Lịch hẹn).
   */
  openCreateAppointment: (link?: CreateAppointmentLink) => void;
  setFilters: (changes: Partial<CustomerFilters>) => void;
  resetFilters: () => void;
  /** Gỡ các thẻ đã gộp/xóa khỏi bộ lọc thẻ đang lưu của danh sách khách (FR-42). */
  dropTagsFromFilters: (tagIds: string[]) => void;
  /**
   * Gộp thẻ A vào B: thay A bằng B trong bộ lọc thẻ (khử trùng nếu B đã chọn) — FR-42.
   * Trả hàm hoàn tác (khôi phục bộ lọc thẻ trước khi thay) để gọi khi API gộp thất bại. Hoàn tác là no-op khi lần thay không đổi gì
   * hoặc khi người dùng đã tự đổi bộ lọc thẻ sau đó (không đè lựa chọn mới).
   */
  replaceTagInFilters: (fromTagId: string, toTagId: string) => () => void;
  /** Gỡ id thẻ không còn tồn tại khỏi bộ lọc; CHỈ gọi khi danh sách thẻ đã tải xong. */
  pruneStaleTagFilters: (existingTagIds: string[]) => void;
  showToast: (input: ToastInput) => string;
  openModal: (modal: ActiveModal) => void;
  /** `phone` phải là số đầy đủ lấy từ `createPhoneView` (để việc xem số có log). */
  openCallModal: (customerId: string, phone: string) => void;
  openZaloModal: (customerId: string, phone: string) => void;
  openQuickNote: (customerId: string) => void;
  openLightbox: (images: GalleryImage[], startIndex?: number, title?: string) => void;
  openAdvancedFilter: () => void;
  closeModal: () => void;
  /** Đổi người dùng đăng nhập giả (chỉ bộ chuyển ở môi trường dev). */
  switchUser: (userId: string) => void;
}

export interface CrmActionDependencies {
  dispatch: (action: CrmAction) => void;
  getState: () => CrmState;
  router: CrmRouterBridge;
}

/** Hai danh sách id giống hệt nhau (cùng thứ tự). */
const isSameIdList = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((id, index) => id === right[index]);

/** Toast có nút hành động (vd "Hoàn tác"): nút đóng toast rồi gọi `onClick`. */
const renderActionToast = (content: string, action: NonNullable<ToastInput['action']>) => (toastItem: { id: string }) =>
  createElement(
    'span',
    { className: 'flex items-center gap-3 whitespace-pre-line' },
    createElement('span', null, content),
    createElement(
      'button',
      {
        type: 'button',
        className: 'shrink-0 rounded-md px-2 py-1 text-sm font-semibold text-brand-600 hover:bg-brand-50',
        onClick: () => {
          toast.dismiss(toastItem.id);
          action.onClick();
        },
      },
      action.label,
    ),
  );

export const createCrmActions = ({ dispatch, getState, router }: CrmActionDependencies): CrmActions => {
  const showToast: CrmActions['showToast'] = ({ type = 'success', title, message, action, durationMs = TOAST_DURATION_MS }) => {
    const content = message ? `${title}\n${message}` : title;
    const options = { duration: durationMs, style: { whiteSpace: 'pre-line' as const } };
    if (action) return toast(renderActionToast(content, action), options);
    if (type === 'success') return toast.success(content, options);
    if (type === 'error') return toast.error(content, options);
    return toast(content, options);
  };

  const navigate: CrmActions['navigate'] = (view, options) =>
    router.navigateTo(buildCrmPath(view, getState().selectedCustomerId), options);

  const selectCustomer: CrmActions['selectCustomer'] = (customerId, options) => {
    dispatch({ type: 'customers/select', customerId });
    if (options?.shouldOpenDetail ?? true) {
      router.navigateTo(buildCrmPath('customer_detail', customerId), { shouldReplace: options?.shouldReplace });
    }
  };

  const openModal: CrmActions['openModal'] = (modal) => dispatch({ type: 'modal/open', modal });

  return {
    navigate,
    // Bọc lại để không truyền nhầm sự kiện click (`onClick={goBack}`) thành `fallbackPath`.
    goBack: () => router.goBack(),
    goBackTo: (fallbackPath) => router.goBack(fallbackPath),
    selectCustomer,
    openCreateAppointment: (link) => router.navigateTo(buildCreateAppointmentPath(link)),
    setFilters: (changes) => dispatch({ type: 'filters/set', changes }),
    resetFilters: () => dispatch({ type: 'filters/reset' }),
    dropTagsFromFilters: (tagIds) => dispatch({ type: 'filters/dropTags', tagIds }),
    replaceTagInFilters: (fromTagId, toTagId) => {
      const previousTagIds = getState().filters.tagIds;
      dispatch({ type: 'filters/replaceTag', fromTagId, toTagId });
      const replacedTagIds = getState().filters.tagIds;
      // A vốn không có trong bộ lọc: lần thay không đổi gì nên không có gì để hoàn tác (không dispatch thừa).
      if (isSameIdList(previousTagIds, replacedTagIds)) return () => undefined;
      return () => {
        // Người dùng đã tự đổi bộ lọc thẻ trong lúc chờ API: không đè lên lựa chọn mới của họ.
        if (!isSameIdList(getState().filters.tagIds, replacedTagIds)) return;
        dispatch({ type: 'filters/set', changes: { tagIds: previousTagIds } });
      };
    },
    pruneStaleTagFilters: (existingTagIds) => dispatch({ type: 'filters/pruneStaleTags', existingTagIds }),
    showToast,
    openModal,
    openCallModal: (customerId, phone) => openModal({ kind: 'call', customerId, phone }),
    openZaloModal: (customerId, phone) => openModal({ kind: 'zalo', customerId, phone }),
    openQuickNote: (customerId) => openModal({ kind: 'quick_note', customerId }),
    openLightbox: (images, startIndex = 0, title) => {
      if (images.length === 0) return;
      openModal({ kind: 'lightbox', images, startIndex, title });
    },
    openAdvancedFilter: () => openModal({ kind: 'advanced_filter' }),
    closeModal: () => dispatch({ type: 'modal/close' }),
    switchUser: (userId) => dispatch({ type: 'session/setUser', userId }),
  };
};
