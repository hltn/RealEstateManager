/** Kiểu giá trị của một trường chân dung (tài liệu 04 mục 3.4). Không đổi được khi đã có dữ liệu. */
export enum PersonaFieldType {
  TEXT = 'TEXT',
  TEXTAREA = 'TEXTAREA',
  NUMBER = 'NUMBER',
  NUMBER_RANGE = 'NUMBER_RANGE',
  DATE = 'DATE',
  SELECT = 'SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  BOOLEAN = 'BOOLEAN',
}

/** Nguồn thông tin của một giá trị chân dung (QT9). `IMPORTED` chỉ do import (M8) ghi, API không nhận. */
export enum PersonaSource {
  CUSTOMER_SHARED = 'CUSTOMER_SHARED',
  STAFF_OBSERVED = 'STAFF_OBSERVED',
  IMPORTED = 'IMPORTED',
}

/** Nguồn mà người dùng được chọn khi sửa chân dung qua API. */
export const WRITABLE_PERSONA_SOURCES = [
  PersonaSource.CUSTOMER_SHARED,
  PersonaSource.STAFF_OBSERVED,
] as const;

/** Tiêu chí C4 mà trường được liên kết (chỉ để hiển thị, KHÔNG tự đánh dấu hoàn thành tiêu chí). */
export enum LinkedCriterion {
  DEMAND = 'DEMAND',
  MOTIVATION = 'MOTIVATION',
  FINANCE = 'FINANCE',
  TIMING = 'TIMING',
}

/** Mã nhóm trường (`catalog_items` loại PERSONA_GROUP) do seed tạo; không có API quản lý nhóm. */
export enum PersonaGroupCode {
  PERSONAL = 'PERSONAL',
  OCCUPATION = 'OCCUPATION',
  LIFESTYLE = 'LIFESTYLE',
  OCCASION = 'OCCASION',
  FAMILY = 'FAMILY',
  CONTACT = 'CONTACT',
  REAL_ESTATE = 'REAL_ESTATE',
}

export const OPTION_FIELD_TYPES: readonly PersonaFieldType[] = [
  PersonaFieldType.SELECT,
  PersonaFieldType.MULTI_SELECT,
];

/** Kiểu có thể sinh token lọc `personaFilterKeys` (số, khoảng, ngày, văn bản dài không lọc theo đẳng thức). */
export const FILTERABLE_FIELD_TYPES: readonly PersonaFieldType[] = [
  PersonaFieldType.TEXT,
  PersonaFieldType.SELECT,
  PersonaFieldType.MULTI_SELECT,
  PersonaFieldType.BOOLEAN,
];

/** Khóa trường: slug chữ thường, bắt đầu bằng chữ, bất biến sau khi tạo. */
export const PERSONA_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const PERSONA_LABEL_MAX_LENGTH = 100;
export const PERSONA_HELP_TEXT_MAX_LENGTH = 300;
export const PERSONA_MAX_OPTIONS = 50;
/** Tổng số lựa chọn của một trường kể cả lựa chọn đã tắt (lựa chọn không bao giờ bị xóa nên phải có trần). */
export const PERSONA_MAX_TOTAL_OPTIONS = 100;
export const PERSONA_OPTION_VALUE_MAX_LENGTH = 100;
export const PERSONA_MAX_WEIGHT = 100;
export const PERSONA_MAX_SUGGEST_PRIORITY = 1000;
export const PERSONA_TEXT_MAX_LENGTH = 500;
export const PERSONA_TEXTAREA_MAX_LENGTH = 2000;
export const PERSONA_MAX_MULTI_VALUES = 20;
/** Biên số (VNĐ): đủ cho ngân sách hàng nghìn tỷ, chặn số vô lý. */
export const PERSONA_NUMBER_MAX = 1e13;
/** Số trường tối đa gửi trong một lần PATCH chân dung. */
export const PERSONA_MAX_VALUES_PER_REQUEST = 50;
/** Số mục gợi ý "còn thiếu" tối đa (tài liệu 04 mục 3.2.2). */
export const MAX_MISSING_SUGGESTIONS = 5;
export const PERSONA_FILTER_MAX_VALUES = 20;
/** Token lọc: `${fieldKey}=${slug}`; slug tối đa 60 ký tự. */
export const FILTER_SLUG_MAX_LENGTH = 60;
