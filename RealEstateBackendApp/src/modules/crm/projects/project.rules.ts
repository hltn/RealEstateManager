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

export const PROJECT_CODE_MAX_LENGTH = 30;
/**
 * Mã dự án (quyết định #31, đổi 2026-11-04 — PT-031): chỉ chữ A-Z không dấu và số 0-9, viết liền
 * (không khoảng trắng, không `-`, không `_`), 1 đến 30 ký tự. Áp cho mã tạo mới và mã được ĐỔI.
 */
export const PROJECT_CODE_PATTERN = /^[A-Za-z0-9]{1,30}$/;
/**
 * Quy tắc cũ (chữ, số, `-`, `_`, tối đa 30 ký tự): chỉ dùng để chấp nhận PATCH gửi lại đúng mã cũ đang có
 * (không migrate dữ liệu). DTO PATCH chỉ kiểm nới theo mẫu này; service kiểm chặt khi mã thật sự đổi.
 */
export const PROJECT_CODE_LEGACY_PATTERN = /^[A-Za-z0-9_-]{1,30}$/;
export const PROJECT_CODE_MESSAGE = `Mã dự án chỉ gồm chữ không dấu A-Z và số 0-9, viết liền (không khoảng trắng, "-", "_"), tối đa ${PROJECT_CODE_MAX_LENGTH} ký tự`;
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
 * Kiểm mã khi PATCH (PT-031): mã mới trùng mã hiện có (không phân biệt hoa thường) => cho qua dù là mã cũ
 * có `-`/`_`; mã khác mã hiện có thì phải theo quy tắc mới (chỉ A-Z, 0-9). Vi phạm => 400 VALIDATION_FAILED.
 */
export const assertProjectCodeChange = (
  nextCode: string,
  currentCode: string | null | undefined,
): void => {
  // `currentCode` thô (có thể thiếu ở dữ liệu rất cũ): thiếu/rỗng thì mã gửi lên rơi vào kiểm chặt.
  if (
    normalizeProjectCode(nextCode) === normalizeProjectCode(currentCode ?? '')
  )
    return;
  if (PROJECT_CODE_PATTERN.test(nextCode)) return;
  throw new BusinessException(
    ErrorCode.VALIDATION_FAILED,
    PROJECT_CODE_MESSAGE,
    HttpStatus.BAD_REQUEST,
    { fields: ['code'] },
  );
};

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
