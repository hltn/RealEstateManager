/**
 * Cấu hình menu của module CRM: tab module ngang (CrmModuleTabs), bottom nav mobile (CrmBottomNav),
 * submenu "Quản lý khách hàng" ở AppSidebar. Icon = lucide-react (bộ icon chuẩn của Admin App).
 */
import { BarChart3, CalendarDays, CalendarCheck, Users, type LucideIcon } from 'lucide-react';
import type { AdminOnlyView, MainTab, ViewId } from '@crm/types/app';
import { buildCrmPath } from './routes';

export interface CrmNavItem<TView extends ViewId = ViewId> {
  view: TView;
  label: string;
  icon: LucideIcon;
}

/** Tiêu đề hiển thị của từng màn (placeholder, tiêu đề tài liệu). */
export const VIEW_TITLES: Record<ViewId, string> = {
  today: 'Việc hôm nay',
  customers: 'Quản lý khách hàng',
  appointments: 'Lịch hẹn & Nhắc việc',
  reports: 'Báo cáo & Thống kê',
  customer_detail: 'Chi tiết khách hàng',
  create_customer: 'Thêm khách hàng mới',
  edit_persona: 'Cập nhật Chân dung khách hàng',
  edit_investment: 'Cập nhật Thông tin đầu tư',
  create_appointment: 'Tạo lịch hẹn mới',
  projects: 'Quản lý dự án',
  ai_config: 'Cấu hình AI (CRM)',
};

/** 4 tab chính — dùng cho CrmModuleTabs (ngang) và CrmBottomNav (mobile). */
export const MODULE_TAB_ITEMS: CrmNavItem<MainTab>[] = [
  { view: 'today', label: 'Việc hôm nay', icon: CalendarCheck },
  { view: 'customers', label: 'Khách hàng', icon: Users },
  { view: 'appointments', label: 'Lịch hẹn', icon: CalendarDays },
  { view: 'reports', label: 'Báo cáo', icon: BarChart3 },
];

/** Mục con của "Quản lý khách hàng" trong AppSidebar (đường dẫn tuyệt đối). */
export const CRM_SIDEBAR_SUB_ITEMS: { name: string; path: string }[] = [
  ...MODULE_TAB_ITEMS.map((item) => ({ name: VIEW_TITLES[item.view], path: buildCrmPath(item.view) })),
  ...(['projects', 'ai_config'] as AdminOnlyView[]).map((view) => ({ name: VIEW_TITLES[view], path: buildCrmPath(view) })),
];
