/**
 * Lớp truy cập dữ liệu CRM — UI CHỈ import từ đây cho dữ liệu nghiệp vụ.
 * Đọc: React Query hook (`hooks.ts`); ghi: `useCrmApi()` (`httpCrmApi.ts`) gọi API thật `/api/v1`.
 * Báo cáo/nhập/xuất (M8) còn mock có cờ: `mockHooks.ts`.
 */
export * from './hooks';
export * from './types';
export {
  canBulkAssign,
  canExportCustomers,
  canImportCustomers,
  canManageProjects,
  canViewProjectCatalog,
  canViewReports,
  canViewSettings,
  type CrmActor,
} from './access';
export type { CrmApi, SaveProfileInput } from './httpCrmApi';
export type { BulkResult } from './http/careApi';
export type { ProjectBody, CatalogEndpoint } from './http/adminApi';
export type { NotificationItem } from './http/schedulingApi';
export { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_NOTE } from './http/careApi';
export { APPOINTMENT_VERSION_CONFLICT_GUIDE, describeWriteError, isNotFoundError, isVersionConflict, toApiError } from './http/crmErrors';
export type { AssigneeStat, BreakdownItem, DashboardDateField, DashboardQuery, DashboardReport, DashboardSummary } from './dashboard';
export { buildDashboardReportRows } from './dashboard';
