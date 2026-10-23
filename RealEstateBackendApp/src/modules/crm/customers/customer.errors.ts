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
