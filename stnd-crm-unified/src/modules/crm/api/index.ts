/**
 * Lớp truy cập dữ liệu CRM — UI CHỈ import từ đây cho dữ liệu nghiệp vụ.
 * Đọc: hook (`hooks.ts`); ghi: `useCrmApi()` (`crmWriteApi.ts`).
 *
 * [Prototype] Cùng bề mặt (tên hook/hàm/kiểu) với `RealEstateAdminApp/src/modules/crm/api/index.ts`, nhưng KHÔNG gọi HTTP:
 * mọi thứ chạy trên store mock trong trình duyệt (`queries.ts`, `dailyTasks.ts`, `crmWriteApi.ts`). Báo cáo/nhập/xuất file dùng
 * `mockHooks.ts` như app chính (M8 chưa có API).
 */
export * from './hooks';
export * from './types';
export {
  canBulkAssign,
  canExportCustomers,
  canImportCustomers,
  canManageProjects,
  canViewDeletedCustomers,
  canViewProjectCatalog,
  canViewReports,
  canViewSettings,
  type CrmActor,
} from './access';
export type { CrmApi, SaveProfileInput, BulkResult, ProjectBody, CatalogEndpoint } from './crmWriteApi';
export type { NotificationItem } from '@crm/types/crm';
export { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_PER_NOTE } from './crmWriteApi';
export { APPOINTMENT_VERSION_CONFLICT_GUIDE, describeWriteError, isNotFoundError, isVersionConflict, toApiError } from './http/crmErrors';
export type { AssigneeStat, BreakdownItem, DashboardDateField, DashboardQuery, DashboardReport, DashboardSummary } from './dashboard';
export { buildDashboardReportRows } from './dashboard';
