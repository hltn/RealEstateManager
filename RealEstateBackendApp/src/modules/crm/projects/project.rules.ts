import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { normalizeVietnamese } from '../common/utils/vietnamese-text.util';

/** Trạng thái bán hàng của dự án (tài liệu 04 mục 3.3): enum cố định, không có bảng danh mục riêng. */
export enum ProjectStatus {
  UPCOMING = 'UPCOMING',
  SELLING = 'SELLING',
  SOLD_OUT = 'SOLD_OUT',
}

/** Mã dự án (quyết định #31): chữ, số, `-`, `_`, tối đa 20 ký tự. */
export const PROJECT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;
export const PROJECT_NAME_MAX_LENGTH = 120;
export const PROJECT_TEXT_MAX_LENGTH = 200;
export const PROJECT_TYPES_MAX_COUNT = 10;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000;

/**
 * Chuẩn hóa mã để so trùng: chữ HOA. Lưu ở `codeNormalized` (unique, kể cả dự án đã xóa mềm)
 * trong khi `code` giữ nguyên chữ người nhập để hiển thị (tài liệu 04 mục 3.3).
 */
export const normalizeProjectCode = (code: string): string =>
  code.trim().toUpperCase();

/**
 * Chuẩn hóa `propertyTypes`: luôn là MẢNG chuỗi; cắt khoảng trắng, bỏ rỗng, bỏ trùng không phân biệt
 * hoa thường/dấu (giữ thứ tự và cách viết của lần xuất hiện đầu). Dữ liệu cũ dạng chuỗi đơn được bọc thành mảng.
 */
export const normalizePropertyTypes = (value: unknown): string[] => {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    const key = normalizeVietnamese(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
};

/** Khoảng giá: mỗi đầu mút >= 0 (DTO đã kiểm) và khi có cả hai thì `priceFrom <= priceTo`. */
export const assertPriceRange = (
  priceFrom: number | null | undefined,
  priceTo: number | null | undefined,
): void => {
  if (
    priceFrom !== null &&
    priceFrom !== undefined &&
    priceTo !== null &&
    priceTo !== undefined &&
    priceFrom > priceTo
  ) {
    throw new BusinessException(
      ErrorCode.VALIDATION_FAILED,
      'Giá "từ" phải nhỏ hơn hoặc bằng giá "đến"',
      HttpStatus.BAD_REQUEST,
      { fields: ['priceFrom', 'priceTo'] },
    );
  }
};
