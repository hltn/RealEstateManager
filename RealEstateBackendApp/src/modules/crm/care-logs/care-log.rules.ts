import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../../../common/enums/user-role.enum';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { CrmActor } from '../common/access/crm-actor';
import { insufficientRole } from '../customers/customer.errors';
import {
  MAX_ATTACHMENTS_PER_CARE_LOG,
  OCCURRED_AT_FUTURE_TOLERANCE_MS,
} from './care-log.constants';

export interface CareLogOwnership {
  authorId: Types.ObjectId;
}

/** Quản trị và Quản lý (trong phạm vi) sửa/xóa mọi lúc; Nhân viên chỉ khi là tác giả (không giới hạn thời gian, PT-022). */
export const canModifyCareLog = (
  actor: CrmActor,
  log: CareLogOwnership,
): boolean => {
  if (actor.role === UserRole.ADMIN || actor.role === UserRole.MANAGER) {
    return true;
  }
  return log.authorId.equals(actor.userId);
};

/** Như `canModifyCareLog` nhưng ném lỗi: không phải tác giả (và không phải Quản trị/Quản lý) => 403. */
export const assertCanModifyCareLog = (
  actor: CrmActor,
  log: CareLogOwnership,
): void => {
  if (!canModifyCareLog(actor, log)) throw insufficientRole();
};

/** `occurredAt` không được ở tương lai (cho lệch đồng hồ thiết bị tối đa 5 phút). */
export const assertOccurredAtNotFuture = (
  occurredAt: Date,
  now: Date,
): void => {
  if (occurredAt.getTime() > now.getTime() + OCCURRED_AT_FUTURE_TOLERANCE_MS) {
    throw new BusinessException(
      ErrorCode.VALIDATION_FAILED,
      'Thời điểm chăm sóc không được ở tương lai',
      HttpStatus.BAD_REQUEST,
      { field: 'occurredAt' },
    );
  }
};

export const assertAttachmentCount = (count: number): void => {
  if (count > MAX_ATTACHMENTS_PER_CARE_LOG) {
    throw new BusinessException(
      ErrorCode.ATTACHMENT_LIMIT_EXCEEDED,
      `Mỗi ghi chú chỉ được đính kèm tối đa ${MAX_ATTACHMENTS_PER_CARE_LOG} ảnh`,
      HttpStatus.BAD_REQUEST,
      { max: MAX_ATTACHMENTS_PER_CARE_LOG },
    );
  }
};

/** So tập ảnh hiện có với tập ảnh mong muốn: ảnh cần gắn thêm và ảnh cần gỡ. */
export const diffAttachmentIds = (
  current: Types.ObjectId[],
  desired: Types.ObjectId[],
): { toAttach: Types.ObjectId[]; toDetach: Types.ObjectId[] } => {
  const has = (list: Types.ObjectId[], id: Types.ObjectId) =>
    list.some((item) => item.equals(id));
  const unique = [...new Map(desired.map((id) => [String(id), id])).values()];
  return {
    toAttach: unique.filter((id) => !has(current, id)),
    toDetach: current.filter((id) => !has(unique, id)),
  };
};
