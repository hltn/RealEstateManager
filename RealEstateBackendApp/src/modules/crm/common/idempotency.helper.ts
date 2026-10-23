import { HttpStatus } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import {
  buildIdempotencyKey,
  IdempotencyService,
} from '../../../common/services/idempotency.service';
import { runIdempotent } from '../../../common/utils/idempotent-request.util';

/**
 * Bọc thao tác POST theo `X-Idempotency-Key` với khóa GẮN THEO NGƯỜI DÙNG + ROUTE (người B không nhận lại response
 * đã lưu của người A dù trùng/đoán được key). Không có header thì chạy thẳng; đang xử lý => 409 `IDEMPOTENCY_IN_PROGRESS`.
 */
export const runCrmIdempotent = <T>(
  idempotency: IdempotencyService,
  userId: string,
  route: string,
  clientKey: string | undefined,
  work: () => Promise<T>,
): Promise<T> =>
  runIdempotent(
    idempotency,
    clientKey ? buildIdempotencyKey({ userId, route }, clientKey) : undefined,
    work,
    () => {
      throw new BusinessException(
        ErrorCode.IDEMPOTENCY_IN_PROGRESS,
        'Yêu cầu đang được xử lý, vui lòng không gửi lại',
        HttpStatus.CONFLICT,
      );
    },
  );
