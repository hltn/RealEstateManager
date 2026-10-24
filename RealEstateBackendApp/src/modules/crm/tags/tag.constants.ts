/** Nhóm thẻ (tài liệu 04 mục 3.3): sở thích, nghề nghiệp, khác. */
export enum TagCategory {
  INTEREST = 'INTEREST',
  OCCUPATION = 'OCCUPATION',
  OTHER = 'OTHER',
}

export const TAG_NAME_MAX_LENGTH = 50;
/** Số thẻ tối đa gắn cho một khách (chống gắn tràn lan làm nặng hồ sơ). */
export const MAX_TAGS_PER_CUSTOMER = 30;
export const TAG_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$|^[a-z][a-z0-9_-]{0,19}$/;
