/**
 * Action creator phía GIAO DIỆN của module CRM: điều hướng, toast, modal, bộ lọc, đăng nhập giả.
 * Thao tác DỮ LIỆU (tạo/sửa khách, nhật ký, lịch hẹn...) KHÔNG nằm ở đây mà ở lớp truy cập dữ liệu `@crm/api`
 * (hàm đặt tên theo endpoint tài liệu 05) để sau này thay mock bằng API thật mà UI không đổi.
 */
import { createElement } from 'react';
import toast from 'react-hot-toast';
import { buildCrmPath } from '@crm/routes';
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
  goBack: () => void;
}

export interface CrmActions {
  navigate: (view: ViewId, options?: CrmNavigateOptions) => void;
  goBack: () => void;
  /** Chọn khách; mặc định mở luôn màn chi tiết. */
  selectCustomer: (customerId: string, options?: { shouldOpenDetail?: boolean } & CrmNavigateOptions) => void;
  setFilters: (changes: Partial<CustomerFilters>) => void;
  resetFilters: () => void;
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
    goBack: router.goBack,
    selectCustomer,
    setFilters: (changes) => dispatch({ type: 'filters/set', changes }),
    resetFilters: () => dispatch({ type: 'filters/reset' }),
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
