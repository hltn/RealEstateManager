/**
 * Lớp truy cập dữ liệu CRM (repository/service phía client) — UI CHỈ import từ đây cho dữ liệu nghiệp vụ.
 * Tên hàm/hook bám endpoint tài liệu 05; bản hiện tại chạy trên store mock.
 */
export * from './hooks';
export * from './types';
export {
  canBulkAssign,
  canExportCustomers,
  canImportCustomers,
  canViewProjectCatalog,
  canViewReports,
  canViewSettings,
  type CrmActor,
} from './access';
export type { BulkOperation, CrmApi, ImportCustomerRow } from './mockCrmApi';
export type { AssigneeStat, BreakdownItem, DashboardDateField, DashboardQuery, DashboardReport, DashboardSummary } from './dashboard';
export { buildDashboardReportRows } from './dashboard';
export type { AdminCatalogKind } from './catalogAdmin';
export { countCatalogUsage, SETTINGS_LIMITS } from './catalogAdmin';
