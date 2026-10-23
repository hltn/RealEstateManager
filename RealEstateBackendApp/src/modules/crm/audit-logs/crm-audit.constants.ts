/**
 * Hằng số nhật ký audit CRM (tài liệu 04 mục 3.7 / 3.7.1).
 * `entityType` là enum đóng ở schema nhưng CHỈ ĐƯỢC THÊM giá trị (zero-downtime);
 * `action` lưu dạng chuỗi tự do để các milestone sau thêm hành động không cần đổi schema.
 */
export enum CrmAuditEntityType {
  CUSTOMER = 'CUSTOMER',
  CARE_LOG = 'CARE_LOG',
  ATTACHMENT = 'ATTACHMENT',
  APPOINTMENT = 'APPOINTMENT',
  CATALOG = 'CATALOG',
  PROJECT = 'PROJECT',
  PERSONA_FIELD = 'PERSONA_FIELD',
  TEAM = 'TEAM',
  IMPORT = 'IMPORT',
  EXPORT = 'EXPORT',
  SETTINGS = 'SETTINGS',
  /** Thêm ở M1: thay đổi nhóm của người dùng (ảnh hưởng phạm vi khách). */
  USER = 'USER',
}

/** Hành động audit thuộc phạm vi M1 (danh mục, dự án, nhóm, cài đặt). */
export enum CrmAuditAction {
  CATALOG_CREATED = 'CATALOG_CREATED',
  CATALOG_UPDATED = 'CATALOG_UPDATED',
  CATALOG_DELETED = 'CATALOG_DELETED',
  PROJECT_CREATED = 'PROJECT_CREATED',
  PROJECT_UPDATED = 'PROJECT_UPDATED',
  PROJECT_DEACTIVATED = 'PROJECT_DEACTIVATED',
  PROJECT_DELETED = 'PROJECT_DELETED',
  PROJECT_RESTORED = 'PROJECT_RESTORED',
  TEAM_CREATED = 'TEAM_CREATED',
  TEAM_UPDATED = 'TEAM_UPDATED',
  TEAM_DELETED = 'TEAM_DELETED',
  USER_TEAM_CHANGED = 'USER_TEAM_CHANGED',
  USER_ROLE_CHANGED = 'USER_ROLE_CHANGED',
  USER_STATUS_CHANGED = 'USER_STATUS_CHANGED',
  SETTINGS_UPDATED = 'SETTINGS_UPDATED',
}

export type CrmAuditSource = 'WEB' | 'MOBILE' | 'IMPORT' | 'SYSTEM';

export interface CrmAuditChange {
  field: string;
  from: unknown;
  to: unknown;
}
