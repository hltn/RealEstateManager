import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserStatus } from '../../../common/enums/user-status.enum';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { buildRevocationSet } from './push-revocation.util';
import { PushRevokedReason } from './push-subscription.constants';
import {
  PushSubscription,
  PushSubscriptionDocument,
} from './schemas/push-subscription.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Thiết bị không hoạt động quá 90 ngày thì xóa cứng: đúng 90 ngày còn, 91 ngày xóa (Architecture 5.6). */
export const PUSH_SUBSCRIPTION_INACTIVE_DAYS = 90;

export interface PushCleanupResult {
  /** Số subscription bị xóa cứng vì `lastSeenAt` quá 90 ngày. */
  deleted: number;
  /** Số subscription bị thu hồi `GONE` vì `expirationTime` đã qua. */
  expired: number;
  /** Số subscription bị thu hồi `ACCOUNT_DISABLED` vì chủ không còn `ACTIVE`/đã xóa. */
  accountDisabled: number;
}

/**
 * Dọn `push_subscriptions` (job lặp `push.cleanup` mỗi 6 giờ, FR-05). IDEMPOTENT: chạy lại ngay sau đó không đổi gì
 * thêm, chạy song song hai instance cũng không xóa thừa (mọi bước là điều kiện theo thời gian/trạng thái).
 * Bản đã thu hồi do TTL index `purgeAt` tự xóa sau 7 ngày nên không xử lý ở đây.
 *
 * Xóa cứng là dữ liệu kỹ thuật (không phải PII nghiệp vụ); đăng ký lại sau khi bị xóa là upsert mới bình thường.
 */
@Injectable()
export class PushCleanupService {
  private readonly logger = new Logger(PushCleanupService.name);

  constructor(
    @InjectModel(PushSubscription.name)
    private readonly subscriptionModel: Model<PushSubscriptionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async run(now: Date = new Date()): Promise<PushCleanupResult> {
    // Thu hồi trước khi xóa cứng chỉ để số liệu rõ ràng; các bước độc lập, thứ tự không ảnh hưởng kết quả cuối.
    const expired = await this.revokeExpired(now);
    const accountDisabled = await this.revokeForInactiveUsers(now);
    const deleted = await this.deleteInactive(now);
    this.logger.log(
      `push.cleanup: xóa ${deleted} (quá ${PUSH_SUBSCRIPTION_INACTIVE_DAYS} ngày), hết hạn ${expired}, chủ không hoạt động ${accountDisabled}`,
    );
    return { deleted, expired, accountDisabled };
  }

  /** `lastSeenAt` < now - 90 ngày (nghiêm ngặt: đúng 90 ngày còn). */
  private async deleteInactive(now: Date): Promise<number> {
    const threshold = new Date(
      now.getTime() - PUSH_SUBSCRIPTION_INACTIVE_DAYS * DAY_MS,
    );
    const result = await this.subscriptionModel
      .deleteMany({ lastSeenAt: { $lt: threshold } })
      .exec();
    return result.deletedCount;
  }

  /** Thiết bị còn hiệu lực nhưng `expirationTime` (trình duyệt báo) đã qua. */
  private async revokeExpired(now: Date): Promise<number> {
    const result = await this.subscriptionModel
      .updateMany(
        { revokedAt: null, expirationTime: { $ne: null, $lt: now } },
        { $set: buildRevocationSet(PushRevokedReason.GONE, now) },
      )
      .exec();
    return result.modifiedCount;
  }

  /** Chủ không còn `ACTIVE`, đã soft-delete hoặc không còn tồn tại: thu hồi mọi thiết bị còn hiệu lực. */
  private async revokeForInactiveUsers(now: Date): Promise<number> {
    const holders = (await this.subscriptionModel
      .distinct('userId', { revokedAt: null })
      .exec()) as Types.ObjectId[];
    if (holders.length === 0) return 0;
    const healthy = await this.userModel
      .find({
        _id: { $in: holders },
        status: UserStatus.ACTIVE,
        deletedAt: null,
      })
      .select('_id')
      .lean()
      .exec();
    const healthyIds = new Set(healthy.map((user) => String(user._id)));
    const stale = holders.filter((id) => !healthyIds.has(String(id)));
    if (stale.length === 0) return 0;
    const result = await this.subscriptionModel
      .updateMany(
        { userId: { $in: stale }, revokedAt: null },
        { $set: buildRevocationSet(PushRevokedReason.ACCOUNT_DISABLED, now) },
      )
      .exec();
    return result.modifiedCount;
  }
}
