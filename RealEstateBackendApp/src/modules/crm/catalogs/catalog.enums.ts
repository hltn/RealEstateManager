/** Nhóm danh sách của tình trạng khách (tài liệu 04 mục 3.3). Tab "Tất cả" (ALL) là tab ảo, KHÔNG lưu trong DB. */
export enum ListGroup {
  NOT_CONTACTED = 'NOT_CONTACTED',
  INTERESTED = 'INTERESTED',
  NET = 'NET',
  DROPPED = 'DROPPED',
}

/** Loại danh mục phẳng dùng chung collection `catalog_items`. PERSONA_GROUP thuộc M4 (chưa có API). */
export enum CatalogItemType {
  LEAD_SOURCE = 'LEAD_SOURCE',
  CONTACT_RESULT = 'CONTACT_RESULT',
  PERSONA_GROUP = 'PERSONA_GROUP',
}

export enum AreaType {
  COUNTRY = 'COUNTRY',
  PROVINCE = 'PROVINCE',
  DISTRICT = 'DISTRICT',
  WARD = 'WARD',
  OTHER = 'OTHER',
}

/** Mã danh mục: chữ HOA, số, `_`; bắt đầu bằng chữ; tối đa 30 ký tự. Ví dụ `FACEBOOK_ADS`. */
export const CATALOG_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,29}$/;
