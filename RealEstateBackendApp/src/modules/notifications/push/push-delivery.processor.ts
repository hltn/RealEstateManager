import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { UnrecoverableError } from 'bullmq';
import { Model, Types } from 'mongoose';
import { UserStatus } from '../../../common/enums/user-status.enum';
import {
  FeatureFlag,
  FeatureFlagService,
} from '../../../shared/feature-flags/feature-flag.service';
import { PiiCryptoService } from '../../crm/common/crypto/pii-crypto.service';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { NotificationPushStatus } from '../notification.constants';
import {
  isInQuietHours,
  isPushEnabled,
  toVnHHmm,
} from '../notification-preference.rules';
import {
  Notification,
  NotificationDocument,
} from '../schemas/notification.schema';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from '../schemas/notification-preference.schema';
import { getPushCatalogEntry } from './push-catalog';
import { PushRenderError, renderPushContent } from './push-content.renderer';
import { buildPushAuthAad, shortEndpointHash } from './push-endpoint.policy';
import { PushGroupLimiter } from './push-group-limiter.service';
import {
  PUSH_PROVIDER,
  type PushPayload,
  type PushProvider,
  type PushSendOptions,
  type PushSendResult,
} from './push-provider.interface';
import { buildRevocationSet } from './push-revocation.util';
import {
  PUSH_SUBSCRIPTION_MAX_PER_USER,
  PushRevokedReason,
} from './push-subscription.constants';
import {
  PushDelivery,
  PushDeliveryDocument,
  PushDeliveryStatus,
} from './schemas/push-delivery.schema';
import {
  PushSubscription,
  PushSubscriptionDocument,
} from './schemas/push-subscription.schema';

/** Mặc định khi loại ngoài danh mục (không xảy ra thường): giữ 24 giờ, mức thường. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
/** Mã lỗi khi `provider.send` ném ngoài hợp đồng hoặc `auth` không giải mã được (không kèm nội dung lỗi). */
const CODE_PROVIDER_ERROR = 'PROVIDER_ERROR';
const CODE_DECRYPT_ERROR = 'DECRYPT_ERROR';
const MONGO_DUPLICATE_KEY = 11000;

/** Dữ liệu job `push.send`. */
export interface PushSendJobLike {
  data: { notificationId?: unknown };
  /** Số lần đã thử trước lần này (BullMQ: 0 ở lần đầu). */
  attemptsMade: number;
  opts?: { attempts?: number };
}

/** Các trạng thái "đã xong" của một thiết bị: không gửi lại khi retry/chạy trùng. */
const FINISHED_DELIVERY: PushDeliveryStatus[] = [
  PushDeliveryStatus.SENT,
  PushDeliveryStatus.GONE,
  PushDeliveryStatus.FAILED,
];

/**
 * Xử lý job `push.send` (FR-02, FR-03, FR-04; Architecture 5.4). Do `PushQueueWorker` (router) gọi `process`.
 * Log CHỈ ghi `notificationId`, `subscriptionId`, `endpointHash` (rút gọn), mã kết quả: không bao giờ `endpoint` thô,
 * payload hay tên khách.
 */
@Injectable()
export class PushDeliveryProcessor {
  private readonly logger = new Logger(PushDeliveryProcessor.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly preferenceModel: Model<NotificationPreferenceDocument>,
    @InjectModel(PushSubscription.name)
    private readonly subscriptionModel: Model<PushSubscriptionDocument>,
    @InjectModel(PushDelivery.name)
    private readonly deliveryModel: Model<PushDeliveryDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    private readonly featureFlags: FeatureFlagService,
    private readonly crypto: PiiCryptoService,
    private readonly groupLimiter: PushGroupLimiter,
  ) {}

  /**
   * 9 bước của Architecture 5.4 (kèm bước giới hạn đợt hàng loạt của 5.5 giữa bước 6 và 7). Ném lỗi thường để BullMQ retry (TRANSIENT); ném `UnrecoverableError` khi không thể
   * khỏi bằng thử lại (`PushRenderError`). Mọi lần đặt `pushStatus` đều có điều kiện `PENDING` (idempotent, không đè
   * kết quả của instance khác).
   */
  async process(job: PushSendJobLike): Promise<void> {
    const rawId = job.data?.notificationId;
    if (typeof rawId !== 'string' || !Types.ObjectId.isValid(rawId)) {
      this.logger.error('push.send: notificationId không hợp lệ, bỏ job');
      return;
    }
    const notificationId = new Types.ObjectId(rawId);
    try {
      await this.deliver(notificationId, job);
    } catch (error) {
      if (!(error instanceof PushRenderError)) throw error;
      // Lỗi lập trình (biến lạ): thử lại 5 lần cũng vô ích. Không ghi `error.message` (có thể chứa tên biến/nội dung).
      await this.settle(notificationId, NotificationPushStatus.FAILED);
      this.logger.error(
        `push.send notificationId=${rawId} result=RENDER_ERROR (không thử lại)`,
      );
      throw new UnrecoverableError('PUSH_RENDER_ERROR');
    }
  }

  private async deliver(
    notificationId: Types.ObjectId,
    job: PushSendJobLike,
  ): Promise<void> {
    // (1) Cờ tắt: mọi thông báo PENDING thành SKIPPED (quay lui nhanh).
    if (
      !this.featureFlags.isEnabled(FeatureFlag.CRM_PUSH) ||
      !this.provider.isEnabled()
    ) {
      await this.settle(notificationId, NotificationPushStatus.SKIPPED);
      return;
    }

    // (2) Không còn PENDING (đã xử lý/đã xóa): dừng, job idempotent.
    const notification = await this.notificationModel
      .findOne({
        _id: notificationId,
        pushStatus: NotificationPushStatus.PENDING,
      })
      .select('userId type data push pushGroupKey')
      .lean()
      .exec();
    if (!notification) return;
    const userId = notification.userId;

    // (3) Người nhận không còn ACTIVE/đã xóa: SKIPPED + thu hồi mọi thiết bị.
    const recipient = await this.userModel
      .findOne({ _id: userId, status: UserStatus.ACTIVE, deletedAt: null })
      .select('_id')
      .lean()
      .exec();
    if (!recipient) {
      await this.subscriptionModel
        .updateMany(
          { userId, revokedAt: null },
          { $set: buildRevocationSet(PushRevokedReason.ACCOUNT_DISABLED) },
        )
        .exec();
      await this.settle(notificationId, NotificationPushStatus.SKIPPED);
      return;
    }

    // (4) tắt push của loại, (5) giờ yên lặng (đọc cài đặt hiện tại: có thể đã đổi trong lúc chờ).
    const preference = await this.preferenceModel
      .findOne({ userId })
      .select('types quietHours')
      .lean()
      .exec();
    if (
      !isPushEnabled(preference?.types, notification.type) ||
      isInQuietHours(toVnHHmm(new Date()), preference?.quietHours)
    ) {
      await this.settle(notificationId, NotificationPushStatus.SKIPPED);
      return;
    }

    // (6) Thiết bị hiệu lực (tối đa 3, mới hoạt động nhất trước).
    const subscriptions = await this.subscriptionModel
      .find({ userId, revokedAt: null })
      .sort({ lastSeenAt: -1 })
      .limit(PUSH_SUBSCRIPTION_MAX_PER_USER)
      .lean()
      .exec();
    if (subscriptions.length === 0) {
      await this.settle(notificationId, NotificationPushStatus.SKIPPED);
      return;
    }

    // (6b) Thêm hàng loạt (T-33, Q5): tối đa 3 push cho mỗi (người, đợt). Đặt SAU bước 6 để thông báo không có
    // thiết bị không tốn hạn mức; bộ đếm idempotent theo `notificationId` nên retry không đếm lại. Redis lỗi: vẫn gửi.
    const isAllowed = await this.groupLimiter.tryAcquire(
      String(userId),
      notification.pushGroupKey,
      String(notificationId),
    );
    if (!isAllowed) {
      await this.settle(notificationId, NotificationPushStatus.SKIPPED);
      return;
    }

    const payload = this.buildPayload(notificationId, notification);
    const options = this.buildOptions(notificationId, notification.type);

    // (7) Từng thiết bị: claim nguyên tử rồi gửi.
    let hasTransient = false;
    for (const subscription of subscriptions) {
      const result = await this.sendToSubscription(
        notificationId,
        userId,
        subscription,
        payload,
        options,
      );
      if (result === 'TRANSIENT') hasTransient = true;
    }

    // (8)-(9) Tổng hợp.
    const isLastAttempt =
      job.attemptsMade + 1 >= (job.opts?.attempts ?? Number.POSITIVE_INFINITY);
    const { status: final, inFlight } = await this.aggregate(
      notificationId,
      subscriptions.map((s) => s._id),
    );
    // `inFlight`: còn hàng SENDING (TRANSIENT của mình, hoặc hàng của worker khác mà mình thua claim E11000): chưa
    // được chốt FAILED/SKIPPED khi còn lần retry, vì kết quả thật chưa biết.
    if ((hasTransient || inFlight) && !isLastAttempt) {
      // Ném lỗi: BullMQ retry, chỉ thiết bị chưa xong được làm lại nhờ `push_deliveries`.
      throw new Error(
        `PUSH_TRANSIENT notificationId=${String(notificationId)}`,
      );
    }
    await this.settle(notificationId, final);
    if (hasTransient) {
      // Hết lần thử: thông báo đã chốt (FAILED, hoặc SENT nếu có thiết bị nhận); ném lỗi để job hiện là failed.
      throw new UnrecoverableError('PUSH_TRANSIENT_EXHAUSTED');
    }
  }

  /** Claim, gửi và ghi kết quả cho MỘT thiết bị. Trả `null` khi thiết bị đã xong/đang do nơi khác xử lý. */
  private async sendToSubscription(
    notificationId: Types.ObjectId,
    userId: Types.ObjectId,
    subscription: PushSubscription & { _id: Types.ObjectId },
    payload: PushPayload,
    options: PushSendOptions,
  ): Promise<'DONE' | 'TRANSIENT' | null> {
    const subscriptionId = subscription._id;
    const claimed = await this.claim(notificationId, userId, subscriptionId);
    if (!claimed) return null;

    const logId = `notificationId=${String(notificationId)} subscriptionId=${String(subscriptionId)} endpointHash=${shortEndpointHash(subscription.endpointHash)}`;
    let auth: string;
    try {
      auth = this.crypto.decrypt(
        subscription.keys.authEnc,
        buildPushAuthAad(String(userId), subscription.endpointHash),
      );
    } catch {
      // Dữ liệu `auth` hỏng/sai khóa: không retry được. Không ghi nội dung lỗi.
      return this.failPermanently(claimed, logId, CODE_DECRYPT_ERROR);
    }
    let result: PushSendResult;
    try {
      result = await this.provider.send(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.keys.p256dh, auth },
        },
        payload,
        options,
      );
    } catch {
      // Hợp đồng `send` không ném; nếu vẫn ném thì coi là lỗi cố định của thiết bị này (không kèm nội dung lỗi).
      return this.failPermanently(claimed, logId, CODE_PROVIDER_ERROR);
    }

    const code = result.statusCode ? String(result.statusCode) : result.outcome;
    switch (result.outcome) {
      case 'SENT':
        await this.finishDelivery(claimed, PushDeliveryStatus.SENT, null);
        await this.subscriptionModel
          .updateOne(
            { _id: subscriptionId },
            { $set: { lastSeenAt: new Date() } },
          )
          .exec();
        this.logger.log(`push.send ${logId} result=SENT code=${code}`);
        return 'DONE';
      case 'GONE':
        await this.finishDelivery(claimed, PushDeliveryStatus.GONE, code);
        await this.subscriptionModel
          .updateOne(
            { _id: subscriptionId, revokedAt: null },
            { $set: buildRevocationSet(PushRevokedReason.GONE) },
          )
          .exec();
        this.logger.log(`push.send ${logId} result=GONE code=${code}`);
        return 'DONE';
      case 'PERMANENT':
        await this.finishDelivery(claimed, PushDeliveryStatus.FAILED, code);
        this.logger.error(`push.send ${logId} result=PERMANENT code=${code}`);
        return 'DONE';
      default:
        // TRANSIENT: giữ SENDING để lần retry claim lại.
        await this.deliveryModel
          .updateOne({ _id: claimed }, { $set: { lastErrorCode: code } })
          .exec();
        this.logger.warn(`push.send ${logId} result=TRANSIENT code=${code}`);
        return 'TRANSIENT';
    }
  }

  private async failPermanently(
    deliveryId: Types.ObjectId,
    logId: string,
    code: string,
  ): Promise<'DONE'> {
    await this.finishDelivery(deliveryId, PushDeliveryStatus.FAILED, code);
    this.logger.error(`push.send ${logId} result=${code}`);
    return 'DONE';
  }

  /**
   * Claim nguyên tử bằng upsert: chỉ khớp khi chưa `SENT`/`GONE`/`FAILED`. Bản đã xong làm upsert đụng unique index
   * (E11000) nên coi là "không claim được".
   */
  private async claim(
    notificationId: Types.ObjectId,
    userId: Types.ObjectId,
    subscriptionId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    try {
      const doc = await this.deliveryModel
        .findOneAndUpdate(
          {
            notificationId,
            subscriptionId,
            status: { $nin: FINISHED_DELIVERY },
          },
          {
            $set: { status: PushDeliveryStatus.SENDING },
            $inc: { attempts: 1 },
            $setOnInsert: { userId, createdAt: new Date() },
          },
          { upsert: true, returnDocument: 'after' },
        )
        .select('_id')
        .lean()
        .exec();
      return doc?._id ?? null;
    } catch (error) {
      if ((error as { code?: number }).code === MONGO_DUPLICATE_KEY)
        return null;
      throw error;
    }
  }

  private async finishDelivery(
    id: Types.ObjectId,
    status: PushDeliveryStatus,
    code: string | null,
  ): Promise<void> {
    await this.deliveryModel
      .updateOne(
        { _id: id },
        {
          $set: {
            status,
            lastErrorCode: code,
            ...(status === PushDeliveryStatus.SENT
              ? { sentAt: new Date() }
              : {}),
          },
        },
      )
      .exec();
  }

  /** Kết quả cuối từ sổ `push_deliveries`: có SENT thì SENT; toàn GONE thì SKIPPED; còn lại FAILED. */
  private async aggregate(
    notificationId: Types.ObjectId,
    subscriptionIds: Types.ObjectId[],
  ): Promise<{ status: NotificationPushStatus; inFlight: boolean }> {
    const rows = await this.deliveryModel
      .find({ notificationId, subscriptionId: { $in: subscriptionIds } })
      .select('status')
      .lean()
      .exec();
    const statuses = rows.map((row) => row.status);
    const inFlight = statuses.includes(PushDeliveryStatus.SENDING);
    if (statuses.includes(PushDeliveryStatus.SENT)) {
      return { status: NotificationPushStatus.SENT, inFlight };
    }
    const allGone =
      statuses.length === 0 ||
      statuses.every((status) => status === PushDeliveryStatus.GONE);
    return {
      status: allGone
        ? NotificationPushStatus.SKIPPED
        : NotificationPushStatus.FAILED,
      inFlight,
    };
  }

  /** Đặt `pushStatus` CÓ ĐIỀU KIỆN `PENDING` (không đè kết quả đã chốt). */
  private async settle(
    notificationId: Types.ObjectId,
    status: NotificationPushStatus,
  ): Promise<void> {
    await this.notificationModel
      .updateOne(
        { _id: notificationId, pushStatus: NotificationPushStatus.PENDING },
        {
          $set: {
            pushStatus: status,
            ...(status === NotificationPushStatus.SENT
              ? { pushSentAt: new Date() }
              : {}),
          },
        },
      )
      .exec();
  }

  /**
   * Nội dung push: ưu tiên bản đã dựng sẵn khi ghi thông báo (Dispatcher). Thiếu (dữ liệu cũ) thì dựng lại không biến
   * (rơi về nội dung dự phòng an toàn); `PushRenderError` nổi lên để `process` coi là không thử lại.
   */
  private buildPayload(
    notificationId: Types.ObjectId,
    notification: {
      type: string;
      data?: { customerId?: Types.ObjectId | null; deepLink?: string } | null;
      push?: { title: string; body: string; url: string } | null;
    },
  ): PushPayload {
    const tag = String(notificationId);
    if (notification.push) {
      return {
        title: notification.push.title,
        body: notification.push.body,
        url: notification.push.url,
        tag,
        type: notification.type,
      };
    }
    const rendered = renderPushContent({
      type: notification.type,
      customerId: notification.data?.customerId
        ? String(notification.data.customerId)
        : undefined,
      deepLink: notification.data?.deepLink,
    });
    return {
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      tag,
      type: rendered.type,
    };
  }

  private buildOptions(
    notificationId: Types.ObjectId,
    type: string,
  ): PushSendOptions {
    const entry = getPushCatalogEntry(type);
    return {
      ttlSeconds: entry?.ttlSeconds ?? DEFAULT_TTL_SECONDS,
      urgency: entry?.urgency ?? 'normal',
      // ObjectId hex 24 ký tự là base64url hợp lệ và ≤ 32.
      topic: String(notificationId),
    };
  }
}
