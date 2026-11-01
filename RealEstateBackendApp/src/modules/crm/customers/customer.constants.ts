import { ListGroup } from '../catalogs/catalog.enums';

/** Vai trò trong nhóm chăm sóc của một khách (tài liệu 04 mục 3.2). */
export enum CareRole {
  PRIMARY = 'PRIMARY',
  MEMBER = 'MEMBER',
}

/** Trạng thái đồng ý xử lý dữ liệu cá nhân (`customers.dataConsent`). */
export enum ConsentStatus {
  UNKNOWN = 'UNKNOWN',
  GRANTED = 'GRANTED',
  WITHDRAWN = 'WITHDRAWN',
}

export enum ConsentMethod {
  VERBAL = 'VERBAL',
  WRITTEN = 'WRITTEN',
  ZALO = 'ZALO',
  OTHER = 'OTHER',
}

/** Kênh tạo khách. `IMPORT` dành cho M8. */
export enum CreatedVia {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
  IMPORT = 'IMPORT',
}

/** Mục đích xem số đầy đủ (ghi vào `reason` của audit PHONE_VIEWED). */
export enum PhoneViewPurpose {
  VIEW = 'VIEW',
  CALL = 'CALL',
  COPY = 'COPY',
}

/** Các tab của danh sách khách: `ALL` là tab ảo (không lưu trong DB). */
export const CUSTOMER_LIST_TABS = ['ALL', ...Object.values(ListGroup)] as const;
export type CustomerListTab = (typeof CUSTOMER_LIST_TABS)[number];

/** 4 tiêu chí đánh giá khách (C4); mỗi tiêu chí hoàn thành = 25% tiến độ. */
export const CRITERIA_KEYS = [
  'demand',
  'motivation',
  'finance',
  'timing',
] as const;
export type CriteriaKey = (typeof CRITERIA_KEYS)[number];

export const CRITERION_DESCRIPTION_MAX_LENGTH = 1000;
export const CUSTOMER_NAME_MAX_LENGTH = 150;
export const CUSTOMER_EMAIL_MAX_LENGTH = 254;
export const CUSTOMER_REASON_MAX_LENGTH = 500;
/** Mặt nạ CCCD: chỉ lộ 4 số cuối. */
export const NATIONAL_ID_MASK_PREFIX = '••••';
/** Giá trị thay thế trong lịch sử khi ẩn danh hóa. */
export const ANONYMIZED_PLACEHOLDER = '[đã ẩn danh]';
export const ANONYMIZED_NAME = 'Khách đã ẩn danh';

/** Hành động audit chỉ Quản trị/Quản lý được xem trong histories (04 mục 3.7.1, 05 mục 2.11). */
export const RESTRICTED_HISTORY_ACTIONS: readonly string[] = [
  'PHONE_VIEWED',
  'NATIONAL_ID_VIEWED',
];
/** Hành động không hiện trong histories của khách (chỉ Quản trị xem ở `/crm/audit-logs`). */
export const HIDDEN_HISTORY_ACTIONS: readonly string[] = [
  'PHONE_LOOKUP',
  'PHONE_SEARCH_ANOMALY',
  'PHONE_VIEW_ALERT',
  'NATIONAL_ID_VIEW_ALERT',
];
