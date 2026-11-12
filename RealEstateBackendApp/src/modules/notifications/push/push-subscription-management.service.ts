import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import {
  PushConfigDto,
  PushSubscriptionListDto,
} from './dtos/push-subscription.dto';
import { PUSH_PROVIDER } from './push-provider.interface';
import type { PushProvider } from './push-provider.interface';
import { buildRevocationSet } from './push-revocation.util';
import {
  PUSH_SUBSCRIPTION_REVOKED_RETENTION_DAYS,
  PushRevokedReason,
} from './push-subscription.constants';
import {
  PushSubscription,
  PushSubscriptionDocument,
} from './schemas/push-subscription.schema';

const DAY_MS = 24 * 60 * 60 * 1000;

const subscriptionNotFound = (): BusinessException =>
  new BusinessException(
    ErrorCode.RESOURCE_NOT_FOUND,
    'Không tìm thấy thiết bị nhận thông báo',
    HttpStatus.NOT_FOUND,
  );

/**
 * Liệt kê, thu hồi và cấu hình thiết bị Web Push (FR-01, FR-05, FR-07, FR-09). Tách khỏi
 * `PushSubscriptionsService` (đăng ký/giới hạn 3) theo Single Responsibility.
 *
 * Mọi truy vấn lọc theo `userId` của CHÍNH người gọi: thiết bị của người khác trả 404 như không tồn tại (không lộ
 * sự tồn tại). Không trường nào trong `endpoint`/`keys`/`endpointHash` đi ra API. Hoạt động bình thường khi cờ
 * `FEATURE_CRM_PUSH` tắt (dữ liệu vẫn được giữ để không mất khi bật cờ sau).
 */
@Injectable()
export class PushSubscriptionManagementService {
  private readonly logger = new Logger(PushSubscriptionManagementService.name);

  constructor(
    @InjectModel(PushSubscription.name)
    private readonly subscriptionModel: Model<PushSubscriptionDocument>,
    private readonly config: ConfigService,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
  ) {}

  /**
   * `enabled` = nhà cung cấp là WebPush đang bật: factory chỉ chọn WebPush khi cờ bật VÀ đủ `VAPID_*` hợp lệ, nên
   * thiếu biến thì `enabled = false` dù cờ bật. `publicKey` chỉ trả khi `enabled` (khóa công khai, không bí mật).
   */
  getConfig(): PushConfigDto {
    const enabled = this.provider.isEnabled();
    const publicKey = (this.config.get<string>('VAPID_PUBLIC_KEY') ?? '')
      .toString()
      .trim();
    return { enabled, publicKey: enabled && publicKey ? publicKey : null };
  }

  /** Thiết bị đang hiệu lực (mới hoạt động trước) + thiết bị bị thu hồi trong 7 ngày gần nhất (mới nhất trước). */
  async list(userId: string): Promise<PushSubscriptionListDto> {
    const owner = new Types.ObjectId(userId);
    const since = new Date(
      Date.now() - PUSH_SUBSCRIPTION_REVOKED_RETENTION_DAYS * DAY_MS,
    );
    const [active, revoked] = await Promise.all([
      this.subscriptionModel
        .find({ userId: owner, revokedAt: null })
        .sort({ lastSeenAt: -1, _id: -1 })
        .select('_id deviceLabel platform lastSeenAt createdAt')
        .lean()
        .exec(),
      this.subscriptionModel
        .find({ userId: owner, revokedAt: { $ne: null, $gte: since } })
        .sort({ revokedAt: -1, _id: -1 })
        .select('deviceLabel revokedReason revokedAt')
        .lean()
        .exec(),
    ]);
    return {
      active: active.map((item) => ({
        id: String(item._id),
        deviceLabel: item.deviceLabel,
        platform: item.platform,
        lastSeenAt: item.lastSeenAt,
        createdAt: item.createdAt,
      })),
      recentlyRevoked: revoked.map((item) => ({
        deviceLabel: item.deviceLabel,
        reason: item.revokedReason as PushRevokedReason,
        revokedAt: item.revokedAt as Date,
      })),
    };
  }

  /**
   * Người dùng tự gỡ một thiết bị (`USER`). Idempotent: thiết bị đã thu hồi vẫn thành công (không đổi lý do/mốc cũ).
   * Không phải của mình hoặc không tồn tại: 404 `RESOURCE_NOT_FOUND`.
   */
  async revokeOwn(userId: string, subscriptionId: string): Promise<void> {
    const owner = new Types.ObjectId(userId);
    const _id = new Types.ObjectId(subscriptionId);
    const result = await this.subscriptionModel
      .updateOne(
        { _id, userId: owner, revokedAt: null },
        { $set: buildRevocationSet(PushRevokedReason.USER) },
      )
      .exec();
    if (result.matchedCount > 0) return;
    const exists = await this.subscriptionModel
      .exists({ _id, userId: owner })
      .exec();
    if (!exists) throw subscriptionNotFound();
  }

  /**
   * Đăng xuất kèm `pushSubscriptionId` (`LOGOUT`): chỉ thu hồi nếu thuộc về CHÍNH người đăng xuất và còn hiệu lực.
   * Id thiếu, sai định dạng, không tồn tại hoặc của người khác đều bị BỎ QUA IM LẶNG (không lộ, không làm hỏng
   * đăng xuất). Trả `true` khi thật sự thu hồi.
   */
  async revokeForLogout(
    userId: string,
    subscriptionId: string | undefined,
  ): Promise<boolean> {
    if (!subscriptionId || !Types.ObjectId.isValid(subscriptionId)) {
      return false;
    }
    try {
      const result = await this.subscriptionModel
        .updateOne(
          {
            _id: new Types.ObjectId(subscriptionId),
            userId: new Types.ObjectId(userId),
            revokedAt: null,
          },
          { $set: buildRevocationSet(PushRevokedReason.LOGOUT) },
        )
        .exec();
      return result.modifiedCount > 0;
    } catch (error) {
      this.logger.warn(
        `Không thu hồi được thiết bị push khi đăng xuất (bỏ qua): ${(error as Error).message}`,
      );
      return false;
    }
  }

  /**
   * Thu hồi MỌI thiết bị còn hiệu lực của một người (khóa/xóa tài khoản: `ACCOUNT_DISABLED`). Truyền `session` để
   * thu hồi cùng transaction với thay đổi trạng thái người dùng. Idempotent; trả số thiết bị vừa thu hồi.
   */
  async revokeAllForUser(
    userId: string | Types.ObjectId,
    reason: PushRevokedReason = PushRevokedReason.ACCOUNT_DISABLED,
    session?: ClientSession,
  ): Promise<number> {
    const result = await this.subscriptionModel
      .updateMany(
        { userId: new Types.ObjectId(String(userId)), revokedAt: null },
        { $set: buildRevocationSet(reason) },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }
}
