import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/exceptions/error-codes';
import { isDuplicateKeyError } from '../../../common/utils/mongo-error.util';
import { PiiCryptoService } from '../../crm/common/crypto/pii-crypto.service';
import {
  PushSubscriptionRegisteredDto,
  RegisterPushSubscriptionDto,
} from './dtos/push-subscription.dto';
import { deriveDeviceInfo } from './push-device.util';
import {
  buildPushAuthAad,
  checkPushEndpoint,
  checkPushKeys,
  computePushEndpointHash,
  resolveHostAllowlist,
  shortEndpointHash,
} from './push-endpoint.policy';
import {
  PUSH_SUBSCRIPTION_MAX_PER_USER,
  PUSH_SUBSCRIPTION_REVOKED_RETENTION_DAYS,
  PushRevokedReason,
} from './push-subscription.constants';
import {
  PushSubscription,
  PushSubscriptionDocument,
} from './schemas/push-subscription.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Chênh `lastSeenAt` được coi là lệch đồng hồ (không phải đăng ký đồng thời) khi xếp hạng giới hạn 3 thiết bị. */
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/** Trường trả ra API: cố ý KHÔNG có `endpoint`, `keys`, `endpointHash`. */
const RESPONSE_FIELDS = '_id deviceLabel platform createdAt lastSeenAt';

interface DisplacedSubscription {
  id: string;
  deviceLabel: string;
}

export interface RegisterPushSubscriptionResult {
  /** `true` = tạo mới (HTTP 201); `false` = upsert/làm mới bản đã có (HTTP 200). */
  created: boolean;
  subscription: PushSubscriptionRegisteredDto;
}

const invalid = (message: string, field: string): BusinessException =>
  new BusinessException(
    ErrorCode.PUSH_SUBSCRIPTION_INVALID,
    message,
    HttpStatus.BAD_REQUEST,
    { field },
  );

/**
 * Đăng ký thiết bị Web Push (FR-01, Architecture 5.6). Tách khỏi gửi push (T-24/T-25) và hủy/liệt kê (T-27).
 *
 * - Upsert theo `endpoint` (duy nhất toàn hệ thống): endpoint đã có, kể cả của người khác hoặc đã thu hồi, được
 *   GÁN LẠI cho người gọi, xóa dấu thu hồi, làm tươi `lastSeenAt` và khóa.
 * - Sau khi lưu, `enforceLimit` giữ tối đa 3 thiết bị hiệu lực mỗi người (gỡ cái `lastSeenAt` cũ nhất,
 *   `LIMIT_EXCEEDED`). Mỗi lần gọi đều thi hành lại nên hội tụ đúng khi hai yêu cầu chạy đồng thời.
 * - `auth` được mã hóa bằng `PiiCryptoService` (AAD gắn userId + endpointHash); log chỉ ghi `endpointHash` rút gọn.
 */
@Injectable()
export class PushSubscriptionsService {
  private readonly logger = new Logger(PushSubscriptionsService.name);
  private readonly hostAllowlist: string[];

  constructor(
    @InjectModel(PushSubscription.name)
    private readonly subscriptionModel: Model<PushSubscriptionDocument>,
    private readonly crypto: PiiCryptoService,
    config: ConfigService,
  ) {
    this.hostAllowlist = resolveHostAllowlist(
      config.get<string>('PUSH_ENDPOINT_HOST_ALLOWLIST'),
    );
  }

  /**
   * Luồng: kiểm endpoint/khóa (400 `PUSH_SUBSCRIPTION_INVALID`) → mã hóa `auth` → upsert (E11000 do hai yêu cầu cùng
   * endpoint đua nhau thì thử lại một lần, lần sau thành cập nhật) → `enforceLimit` → trả thiết bị vừa lưu +
   * thiết bị bị gỡ (nếu có).
   */
  async register(
    userId: string,
    dto: RegisterPushSubscriptionDto,
    userAgent?: string,
  ): Promise<RegisterPushSubscriptionResult> {
    const endpointCheck = checkPushEndpoint(dto.endpoint, this.hostAllowlist);
    if (!endpointCheck.valid) throw invalid(endpointCheck.reason, 'endpoint');
    const keyCheck = checkPushKeys(dto.keys.p256dh, dto.keys.auth);
    if (!keyCheck.valid) throw invalid(keyCheck.reason, 'keys');

    const ownerId = new Types.ObjectId(userId);
    const endpointHash = computePushEndpointHash(dto.endpoint);
    const device = deriveDeviceInfo(userAgent);
    const set = {
      userId: ownerId,
      endpointHash,
      keys: {
        p256dh: dto.keys.p256dh,
        authEnc: this.crypto.encrypt(
          dto.keys.auth,
          buildPushAuthAad(userId, endpointHash),
        ),
      },
      expirationTime:
        dto.expirationTime === undefined || dto.expirationTime === null
          ? null
          : new Date(dto.expirationTime),
      platform: device.platform,
      deviceLabel: device.deviceLabel,
      lastSeenAt: new Date(),
      revokedAt: null,
      revokedReason: null,
      purgeAt: null,
    };

    const upsert = () =>
      this.subscriptionModel
        .findOneAndUpdate(
          { endpoint: dto.endpoint },
          { $set: set },
          {
            upsert: true,
            returnDocument: 'after',
            includeResultMetadata: true,
            lean: true,
            projection: RESPONSE_FIELDS,
            setDefaultsOnInsert: true,
          },
        )
        .exec();

    let result: Awaited<ReturnType<typeof upsert>>;
    try {
      result = await upsert();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      result = await upsert();
    }
    const saved = result.value;
    if (!saved) {
      // Không xảy ra với upsert; chặn để không trả dữ liệu rỗng nếu driver đổi hành vi.
      throw new Error('Upsert push_subscriptions không trả về bản ghi');
    }
    const created = !result.lastErrorObject?.updatedExisting;

    const displaced = await this.enforceLimit(userId, saved);
    this.logger.log(
      `Đăng ký push: user=${userId} endpoint#${shortEndpointHash(endpointHash)} created=${created} displaced=${displaced.length}`,
    );

    return {
      created,
      subscription: {
        id: String(saved._id),
        deviceLabel: saved.deviceLabel,
        platform: saved.platform,
        createdAt: saved.createdAt,
        lastSeenAt: saved.lastSeenAt,
        displaced: displaced[0] ?? null,
      },
    };
  }

  /**
   * Giữ tối đa 3 thiết bị hiệu lực của `userId`: xếp TẤT CẢ thiết bị hiệu lực (kể cả cái vừa đăng ký) theo thứ tự
   * toàn phần "thời điểm hiệu dụng" giảm dần rồi `_id` giảm dần, từ vị trí thứ 4 trở đi bị thu hồi
   * (`LIMIT_EXCEEDED`, `purgeAt = now + 7 ngày`). Mọi yêu cầu dùng chung một thứ tự nên khi nhiều thiết bị đăng ký
   * đồng thời, mỗi yêu cầu chỉ gỡ những cái chắc chắn nằm ngoài top 3 của tập đầy đủ: kết quả hội tụ đúng 3, không
   * gỡ lố (trước đây mỗi yêu cầu ép giữ cái của mình nên có thể còn 0 hoặc 2).
   * Thời điểm hiệu dụng = `lastSeenAt`, trừ khi nó vượt `lastSeenAt` của thiết bị vừa lưu quá `CLOCK_SKEW_TOLERANCE_MS`
   * (đồng hồ lệch/tương lai): khi đó bị kẹp xuống bằng thiết bị vừa lưu, `_id` mới hơn thắng, nên thiết bị vừa đăng ký
   * không bao giờ bị gỡ vì lệch đồng hồ. Người khác không bị ảnh hưởng (lọc theo `userId`). Trả danh sách thiết bị
   * bị gỡ (không gồm thiết bị vừa lưu nếu nó bị yêu cầu đồng thời khác vượt mặt).
   */
  private async enforceLimit(
    userId: string,
    keep: { _id: Types.ObjectId; lastSeenAt: Date },
  ): Promise<DisplacedSubscription[]> {
    const ownerId = new Types.ObjectId(userId);
    const keepTime = keep.lastSeenAt.getTime();
    const effectiveTime = (lastSeenAt: Date) =>
      lastSeenAt.getTime() > keepTime + CLOCK_SKEW_TOLERANCE_MS
        ? keepTime
        : lastSeenAt.getTime();
    const found = await this.subscriptionModel
      .find({ userId: ownerId, revokedAt: null })
      .select('_id deviceLabel lastSeenAt')
      .lean()
      .exec();
    const active = [...found].sort(
      (left, right) =>
        effectiveTime(right.lastSeenAt) - effectiveTime(left.lastSeenAt) ||
        String(right._id).localeCompare(String(left._id)),
    );
    const excess = active.slice(PUSH_SUBSCRIPTION_MAX_PER_USER);
    if (excess.length === 0) return [];

    const revokedAt = new Date();
    await this.subscriptionModel
      .updateMany(
        {
          _id: { $in: excess.map((item) => item._id) },
          userId: ownerId,
          revokedAt: null,
        },
        {
          $set: {
            revokedAt,
            revokedReason: PushRevokedReason.LIMIT_EXCEEDED,
            purgeAt: new Date(
              revokedAt.getTime() +
                PUSH_SUBSCRIPTION_REVOKED_RETENTION_DAYS * DAY_MS,
            ),
          },
        },
      )
      .exec();
    return excess
      .filter((item) => !item._id.equals(keep._id))
      .map((item) => ({
        id: String(item._id),
        deviceLabel: item.deviceLabel,
      }));
  }
}
