import { CRM_SUB_VIEWS, type CrmSubView, type ViewId } from '@crm/types/app';

export const DEFAULT_VIEW: ViewId = 'today';

/** Màn "cha" dùng khi goBack() mà không có lịch sử trình duyệt trong app (vd mở thẳng URL). */
export const PARENT_VIEW_BY_VIEW: Partial<Record<ViewId, ViewId>> = {
  customer_detail: 'customers',
  create_customer: 'customers',
  edit_persona: 'customer_detail',
  edit_investment: 'customer_detail',
  create_appointment: 'appointments',
};

export const getParentView = (view: ViewId): ViewId => PARENT_VIEW_BY_VIEW[view] ?? DEFAULT_VIEW;

export const isCrmSubView = (view: ViewId): view is CrmSubView =>
  (CRM_SUB_VIEWS as readonly ViewId[]).includes(view);

/**
 * Khung giao diện mobile của từng màn:
 * - 'tabs': nội dung + CrmBottomNav (4 tab chính, Dự án).
 * - 'fullscreen': màn chi tiết/form tự vẽ header + nút quay lại + thanh CTA đáy → ẩn CrmBottomNav.
 */
export type MobileChrome = 'tabs' | 'fullscreen';

export const getMobileChrome = (view: ViewId): MobileChrome => (isCrmSubView(view) ? 'fullscreen' : 'tabs');
