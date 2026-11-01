import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../../common/exceptions/error-codes';

export interface ParsedSort {
  field: string;
  direction: 1 | -1;
}

/**
 * Phân tích tham số `sort` theo quy ước tài liệu 05 mục 1.4: một field trong whitelist,
 * tiền tố `-` = giảm dần. Field ngoài whitelist => 400 `INVALID_SORT_FIELD`.
 *
 * Whitelist bắt buộc để người dùng không sort theo field nhạy cảm/không có index.
 */
export const parseSort = (
  sort: string | undefined,
  allowedFields: readonly string[],
  defaultSort: ParsedSort,
): ParsedSort => {
  if (!sort) return defaultSort;
  const direction = sort.startsWith('-') ? -1 : 1;
  const field = sort.replace(/^[-+]/, '');
  if (!allowedFields.includes(field)) {
    throw new BusinessException(
      ErrorCode.INVALID_SORT_FIELD,
      `Không hỗ trợ sắp xếp theo "${field}"`,
      HttpStatus.BAD_REQUEST,
      { allowed: [...allowedFields] },
    );
  }
  return { field, direction };
};
