/**
 * Cấu hình menu của module CRM: tab module ngang (CrmModuleTabs), bottom nav mobile (CrmBottomNav),
 * submenu "Quản lý khách hàng" ở AppSidebar. Mục hiển thị THEO VAI TRÒ (tài liệu 02 §3, §10: không đủ quyền thì ẩn).
 */
import { useMemo } from 'react';
import { BarChart3, CalendarCheck, CalendarDays, Users, type LucideIcon } from 'lucide-react';
import { canViewProjectCatalog, canViewReports, canViewSettings } from '@crm/api/access';
import { useCurrentUser } from '@crm/store/hooks';
import type { AdminOnlyView, MainTab, ViewId } from '@crm/types/app';
import type { UserRole } from '@crm/types/crm';
import { buildCrmPath } from './routes';

export interface CrmNavItem<TView extends ViewId = ViewId> {
  view: TView;
  label: string;
  icon: LucideIcon;
}

/** Tiêu đề hiển thị của từng màn. */
export const VIEW_TITLES: Record<ViewId, string> = {
  today: 'Việc hôm nay',
  customers: 'Khách hàng',
  appointments: 'Lịch hẹn & Nhắc việc',
  reports: 'Báo cáo & Thống kê',
  customer_detail: 'Chi tiết khách hàng',
  create_customer: 'Thêm khách hàng mới',
  edit_persona: 'Cập nhật Chân dung khách hàng',
  edit_investment: 'Cập nhật Nhu cầu BĐS',
  create_appointment: 'Tạo lịch hẹn mới',
  projects: 'Danh sách dự án',
  settings: 'Cài đặt CRM',
};

const ALL_TAB_ITEMS: CrmNavItem<MainTab>[] = [
  { view: 'today', label: 'Việc hôm nay', icon: CalendarCheck },
  { view: 'customers', label: 'Khách hàng', icon: Users },
  { view: 'appointments', label: 'Lịch hẹn', icon: CalendarDays },
  { view: 'reports', label: 'Báo cáo', icon: BarChart3 },
];

/** Màn được phép theo vai trò. */
export const canAccessView = (view: ViewId, role: UserRole): boolean => {
  if (view === 'reports') return canViewReports(role);
  if (view === 'settings') return canViewSettings(role);
  if (view === 'projects') return canViewProjectCatalog(role);
  return true;
};

/** Tab chính theo vai trò (Báo cáo: Quản lý/Quản trị). */
export const getModuleTabItems = (role: UserRole): CrmNavItem<MainTab>[] => ALL_TAB_ITEMS.filter((item) => canAccessView(item.view, role));

/** Mục con "Quản lý khách hàng" ở AppSidebar theo vai trò. */
export const getCrmSidebarSubItems = (role: UserRole): { name: string; path: string }[] => [
  ...getModuleTabItems(role).map((item) => ({ name: VIEW_TITLES[item.view], path: buildCrmPath(item.view) })),
  ...(['projects', 'settings'] as AdminOnlyView[])
    .filter((view) => canAccessView(view, role))
    .map((view) => ({ name: VIEW_TITLES[view], path: buildCrmPath(view) })),
];

/** Hook cho thanh tab / bottom nav (đọc vai trò người dùng CRM hiện tại). */
export const useModuleTabItems = (): CrmNavItem<MainTab>[] => {
  const { role } = useCurrentUser();
  return useMemo(() => getModuleTabItems(role), [role]);
};

/** Hook cho AppSidebar (dùng được ngoài `<CrmProvider>`). */
export const useCrmSidebarSubItems = (): { name: string; path: string }[] => {
  const { role } = useCurrentUser();
  return useMemo(() => getCrmSidebarSubItems(role), [role]);
};

/** Tên mục CRM trong menu chính của AppSidebar. */
export const CRM_MENU_NAME = 'Quản lý khách hàng';

/** Menu chính: ẩn hẳn mục CRM khi module tắt (`VITE_CRM_PROTOTYPE`); bật thì gắn submenu theo vai trò. */
export const withCrmMenu = <T extends { name: string }>(items: readonly T[], crmSubItems: { name: string; path: string }[], isEnabled: boolean): (T | (T & { subItems: { name: string; path: string }[] }))[] =>
  items.filter((item) => item.name !== CRM_MENU_NAME || isEnabled).map((item) => (item.name === CRM_MENU_NAME ? { ...item, subItems: crmSubItems } : item));

