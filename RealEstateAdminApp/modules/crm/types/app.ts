import type { GalleryImage } from './crm';

/** 4 tab chính của bản Mobile (Bottom nav) - cũng là 4 tab module CRM của bản Admin. */
export const MAIN_TABS = ['today', 'customers', 'appointments', 'reports'] as const;
export type MainTab = (typeof MAIN_TABS)[number];

/** Màn hình con của module CRM (cần khách hàng đang chọn hoặc là form). */
export const CRM_SUB_VIEWS = [
  'customer_detail',
  'create_customer',
  'edit_persona',
  'edit_investment',
  'create_appointment',
] as const;
export type CrmSubView = (typeof CRM_SUB_VIEWS)[number];

/** Màn CRM chỉ bản Admin (Stitch web) có, có màn riêng. */
export const ADMIN_ONLY_VIEWS = ['projects', 'ai_config'] as const;
export type AdminOnlyView = (typeof ADMIN_ONLY_VIEWS)[number];

/**
 * Toàn bộ màn hình của module CRM. Mỗi ViewId ứng với 1 route `/crm/...` (xem `modules/crm/routes.ts`).
 * Các màn quản trị cũ (Raw Articles, Manage WP...) là màn thật của Admin App, không nằm trong ViewId.
 */
export type ViewId = MainTab | CrmSubView | AdminOnlyView;

export type ToastType = 'success' | 'info' | 'warning' | 'error';

/** Tham số `showToast` của store CRM — hiển thị qua `react-hot-toast` (Toaster toàn cục ở main.tsx). */
export interface ToastInput {
  title: string;
  message?: string;
  type?: ToastType;
}

/** Modal toàn cục (chỉ 1 modal mở tại 1 thời điểm). */
export type ActiveModal =
  | { kind: 'call'; customerId: string }
  | { kind: 'zalo'; customerId: string }
  | { kind: 'quick_note'; customerId: string }
  | { kind: 'lightbox'; images: GalleryImage[]; startIndex: number; title?: string }
  | { kind: 'advanced_filter' };

