import type { GalleryImage, ListGroup } from './crm';

/** 4 tab chính (bottom nav mobile + tab module ngang). */
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

/** Màn chỉ dành cho Quản trị (tài liệu 02 §3: Cài đặt — danh mục, danh sách dự án, người dùng). */
export const ADMIN_ONLY_VIEWS = ['projects', 'settings'] as const;
export type AdminOnlyView = (typeof ADMIN_ONLY_VIEWS)[number];

/** Toàn bộ màn hình của module CRM. Mỗi ViewId ứng với 1 route `/crm/...` (xem `modules/crm/routes.ts`). */
export type ViewId = MainTab | CrmSubView | AdminOnlyView;

export type ToastType = 'success' | 'info' | 'warning' | 'error';

/** Tham số `showToast` — hiển thị qua `react-hot-toast` (Toaster toàn cục ở main.tsx). */
export interface ToastInput {
  title: string;
  message?: string;
  type?: ToastType;
  /** Nút hành động trong toast (vd "Hoàn tác" sau khi đổi sang "Bỏ"). */
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

/** Modal toàn cục (chỉ 1 modal mở tại 1 thời điểm). */
export type ActiveModal =
  /** `phone` = số đầy đủ đã lấy qua `createPhoneView` (đã ghi log) khi mở modal. */
  | { kind: 'call'; customerId: string; phone: string }
  | { kind: 'zalo'; customerId: string; phone: string }
  | { kind: 'quick_note'; customerId: string }
  | { kind: 'lightbox'; images: GalleryImage[]; startIndex: number; title?: string }
  | { kind: 'advanced_filter' };

/** Tab danh sách khách: 4 nhóm danh sách (C6) + "Tất cả". */
export type CustomerListTab = ListGroup | 'ALL';

/**
 * Bộ lọc danh sách khách (X3) — khớp query của `GET /crm/customers` (05 §2.3).
 * Mảng rỗng / chuỗi rỗng = không lọc theo tiêu chí đó.
 */
export interface CustomerFilters {
  q: string;
  listGroup: CustomerListTab;
  statusIds: string[];
  sourceIds: string[];
  projectIds: string[];
  areaIds: string[];
  /** Bất kỳ ai trong nhóm chăm sóc (phụ trách chính hoặc người hỗ trợ). */
  assigneeIds: string[];
  primaryAssigneeIds: string[];
  /** Mức tiến độ 0/25/50/75/100. */
  progress: number[];
  /** Khoảng ngày cập nhật cuối (khoá ngày VN "YYYY-MM-DD"). */
  updatedFrom: string;
  updatedTo: string;
  occupation: string;
  tagIds: string[];
}
