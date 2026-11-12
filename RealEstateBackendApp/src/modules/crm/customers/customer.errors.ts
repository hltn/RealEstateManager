import { ForbiddenException, HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CrmAuditSource } from '../audit-logs/crm-audit.constants';
import { normalizePhone } from '../common/utils/phone-normalizer.util';
import { CreatedVia } from './customer.constants';
import { NATIONAL_ID_PATTERN } from './utils/customer-rules.util';

/** 404 cho khách không tồn tại HOẶC ngoài phạm vi (không lộ sự tồn tại, tài liệu 04 mục 4.3). */
export const customerNotFound = (): BusinessException =>
  new BusinessException(
    ErrorCode.CUSTOMER_NOT_FOUND,
    'Không tìm thấy khách hàng',
    HttpStatus.NOT_FOUND,
  );

export const versionConflict = (currentVersion: number): BusinessException =>
  new BusinessException(
    ErrorCode.VERSION_CONFLICT,
    'Hồ sơ đã bị người khác chỉnh sửa, vui lòng tải lại rồi thử lại',
    HttpStatus.CONFLICT,
    { currentVersion },
  );

/** Vai trò không đủ quyền thực hiện hành động trên khách mà họ vẫn thấy (khác 404 của ngoài phạm vi). */
export const insufficientRole = (): ForbiddenException =>
  new ForbiddenException('Insufficient role');

/** 409: xóa khách không thuộc nhóm "Bỏ" (xóa hàng loạt, hoặc STAFF xóa đơn). */
export const customerNotDropped = (): BusinessException =>
  new BusinessException(
    ErrorCode.CUSTOMER_NOT_DROPPED,
    'Chỉ xóa được khách thuộc nhóm "Bỏ"',
    HttpStatus.CONFLICT,
  );

/** 409: xóa vĩnh viễn khách chưa bị xóa mềm. */
export const customerNotDeleted = (): BusinessException =>
  new BusinessException(
    ErrorCode.CUSTOMER_NOT_DELETED,
    'Chỉ xóa vĩnh viễn được khách đã xóa mềm',
    HttpStatus.CONFLICT,
  );

/**
 * 409: khách đang trong quá trình xóa vĩnh viễn (`purgingAt` có giá trị): không khôi phục, không ẩn danh hóa, không
 * chạy xóa vĩnh viễn thứ hai song song. Lối thoát duy nhất là bấm "Xóa vĩnh viễn" lại để hoàn tất.
 */
export const customerPurgeInProgress = (): BusinessException =>
  new BusinessException(
    ErrorCode.CUSTOMER_PURGE_IN_PROGRESS,
    'Khách hàng đang được xóa vĩnh viễn; hãy bấm "Xóa vĩnh viễn" lại để hoàn tất thay vì khôi phục hoặc ẩn danh hóa',
    HttpStatus.CONFLICT,
  );

/** Chuẩn hóa SĐT, sai định dạng => 400 `INVALID_PHONE`. */
export const normalizePhoneOrThrow = (input: string): string => {
  const phone = normalizePhone(input);
  if (!phone) {
    throw new BusinessException(
      ErrorCode.INVALID_PHONE,
      'Số điện thoại không hợp lệ',
      HttpStatus.BAD_REQUEST,
      { input },
    );
  }
  return phone;
};

/**
 * Chuẩn hóa SĐT TÙY CHỌN (FR-01): `null`/`undefined`/chuỗi rỗng (hoặc chỉ khoảng trắng) => `null` (không có SĐT);
 * có giá trị mà sai định dạng => 400 `INVALID_PHONE`. Không bao giờ gọi `normalizePhone` với giá trị rỗng.
 */
export const normalizeOptionalPhoneOrThrow = (
  input: string | null | undefined,
): string | null => {
  if (input === null || input === undefined || input.trim() === '') {
    return null;
  }
  return normalizePhoneOrThrow(input);
};

/** CCCD 9 hoặc 12 chữ số, sai => 400 `VALIDATION_FAILED`. */
export const assertValidNationalId = (nationalId: string): void => {
  if (!NATIONAL_ID_PATTERN.test(nationalId)) {
    throw new BusinessException(
      ErrorCode.VALIDATION_FAILED,
      'CCCD phải gồm 9 hoặc 12 chữ số',
      HttpStatus.BAD_REQUEST,
      { field: 'nationalId' },
    );
  }
};

/** Kênh gọi: app di động gửi `X-Client-Type: mobile`, còn lại coi là web. */
export const resolveClientSource = (
  clientType: string | undefined,
): { createdVia: CreatedVia; auditSource: CrmAuditSource } =>
  clientType?.toLowerCase() === 'mobile'
    ? { createdVia: CreatedVia.MOBILE, auditSource: 'MOBILE' }
    : { createdVia: CreatedVia.WEB, auditSource: 'WEB' };
