import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { UserRole } from '../../common/enums/user-role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';
import { registerAfterCommit } from '../../shared/database/after-commit.util';
import { QueueNames } from '../../shared/queue/queue.constants';
import { QueueRuntimeService } from '../../shared/queue/queue-runtime.service';
import {
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  NotificationPriority,
  NotificationPushStatus,
  NotificationType,
} from './notification.constants';
import { isInAppEnabled, isPushEnabled } from './notification-preference.rules';
import { clip } from './notifications.service';
import {
  getPushCatalogEntry,
  PushContext,
  PushVarName,
} from './push/push-catalog';
import { renderPushContent } from './push/push-content.renderer';
import { PushJobNames, pushSendJobId } from './push/push-queue.constants';
import { User, UserDocument } from '../users/schemas/user.schema';
import { PUSH_PROVIDER } from './push/push-provider.interface';
import type { PushProvider } from './push/push-provider.interface';
import {
  Notification,
  NotificationDocument,
  NotificationPushContent,
} from './schemas/notification.schema';
import {
  NotificationPreference,
  NotificationPreferenceDocument,
} from './schemas/notification-preference.schema';

/**
 * "Yêu cầu thông báo" chuẩn (FR-43, FR-44; Architecture 5.2). Không có đường nhập `title/body` push tự do: nội dung
 * push do mẫu của `PUSH_CATALOG` + `vars` cho phép dựng ra.
 */
export interface NotificationRequest {
  /** Loại bất kỳ; chỉ loại có trong `PUSH_CATALOG` mới có push. */
  type: NotificationType;
  /** Người nhận (Dispatcher bỏ trùng và bỏ `excludeUserIds`). */
  recipientIds: Types.ObjectId[];
  /** Người thực hiện hành động (không tự nhận thông báo của chính mình). */
  excludeUserIds?: Types.ObjectId[];
  /** Nội dung hộp thông báo trong app (nơi gọi dựng, KHÔNG chứa SĐT/CCCD). */
  inApp: { title: string; body: string; priority?: NotificationPriority };
  /** Chỉ các biến cho phép của mẫu push; khóa lạ làm `PushRenderError` (lỗi lập trình). */
  vars?: Partial<Record<PushVarName, string>>;
  /**
   * `deepLink` PHẢI do backend tự dựng từ id đã biết (không lấy từ đầu vào người dùng): renderer chỉ kiểm đường dẫn
   * nội bộ bắt đầu `/`, không kiểm id.
   */
  data: {
    customerId?: Types.ObjectId;
    appointmentId?: Types.ObjectId;
    requestId?: Types.ObjectId;
    deepLink: string;
  };
  /** Dữ liệu để `pushWhen` quyết có push hay không; `groupKey` được lưu vào `pushGroupKey`. */
  context?: PushContext;
  /** BẮT BUỘC: trùng `(userId, dedupeKey)` thì không tạo thông báo/push thứ hai. */
  dedupeKey: string;
}

type StoredTypes = Record<string, { push?: boolean; inApp?: boolean }>;

interface PreparedOperation {
  /** Thông báo này chờ push (`pushStatus = PENDING`). */
  isPending: boolean;
  write: {
    updateOne: {
      filter: { userId: Types.ObjectId; dedupeKey: string };
      update: { $setOnInsert: Record<string, unknown> };
      upsert: true;
    };
  };
}

/**
 * Điểm vào DUY NHẤT để tạo thông báo (FR-44): chuẩn hóa người nhận, tôn trọng `inApp`, ghi hộp thông báo bằng
 * upsert theo `(userId, dedupeKey)` (không bao giờ E11000, an toàn trong transaction), quyết `pushStatus` rồi
 * đăng ký `afterCommit` xếp job `push.send` (`jobId` theo id thông báo, xem `pushSendJobId`).
 *
 * `pushStatus = PENDING` khi và chỉ khi: nhà cung cấp push đang bật (cờ + VAPID), loại thuộc `PUSH_CATALOG`, `pushWhen`
 * đúng với `context`, và người nhận chưa tắt `push` cho loại đó. Ngược lại `SKIPPED` và không lưu nội dung push.
 * Giờ yên lặng và trạng thái tài khoản do worker kiểm lúc gửi (T-31). Lỗi Redis chỉ ghi log: thông báo vẫn
 * `PENDING` và job quét (T-32) xếp lại. Push luôn nằm SAU commit nên rollback không bao giờ gửi.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    @InjectModel(NotificationPreference.name)
    private readonly preferenceModel: Model<NotificationPreferenceDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @Inject(PUSH_PROVIDER) private readonly provider: PushProvider,
    private readonly queue: QueueRuntimeService,
  ) {}

  /**
   * Ghi thông báo cho nhiều yêu cầu cùng lúc. Trả số thông báo MỚI thật sự tạo (không tính bản trùng `dedupeKey`
   * hoặc người đã tắt `inApp`). Truyền `session` để ghi cùng transaction với thay đổi nghiệp vụ.
   * Ném `PushRenderError` khi `vars` có biến lạ và Error khi thiếu `dedupeKey` (đều là lỗi lập trình).
   */
  async dispatch(
    requests: NotificationRequest[],
    session?: ClientSession,
  ): Promise<{ created: number }> {
    if (requests.length === 0) return { created: 0 };

    // Dựng nội dung push TRƯỚC khi ghi gì: lỗi lập trình (biến lạ, thiếu khóa) dừng sớm, không ghi dở.
    const contents = requests.map((request) => this.prepareContent(request));

    const preferences = await this.loadPreferences(requests, session);
    const now = new Date();
    const operations: PreparedOperation[] = [];
    for (const [index, request] of requests.entries()) {
      for (const userId of this.recipientsOf(request)) {
        const stored = preferences.get(String(userId));
        if (!isInAppEnabled(stored, request.type)) continue;
        operations.push(
          this.buildOperation(request, contents[index], userId, stored, now),
        );
      }
    }
    if (operations.length === 0) return { created: 0 };

    const result = await this.notificationModel.bulkWrite(
      operations.map((operation) => operation.write),
      { session, ordered: false, timestamps: false },
    );

    // `upsertedIds`: chỉ số thao tác -> _id của bản MỚI tạo (bản trùng `dedupeKey` không có mặt).
    const upsertedIds = (result.upsertedIds ?? {}) as Record<
      number,
      Types.ObjectId
    >;
    for (const [position, id] of Object.entries(upsertedIds)) {
      if (operations[Number(position)]?.isPending) {
        await this.enqueueAfterCommit(String(id), session);
      }
    }
    return { created: result.upsertedCount };
  }

  /**
   * Gửi cho mọi Quản trị đang hoạt động (cảnh báo bảo mật). Lỗi chỉ ghi log và trả 0: không làm hỏng nghiệp vụ gốc.
   * Loại ngoài `PUSH_CATALOG` (như `SECURITY_ALERT`) thì không có push.
   */
  async notifyAdmins(
    request: Omit<NotificationRequest, 'recipientIds'>,
    session?: ClientSession,
  ): Promise<number> {
    try {
      const admins = await this.userModel
        .find({
          roles: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          deletedAt: null,
        })
        .select('_id')
        .session(session ?? null)
        .lean()
        .exec();
      const { created } = await this.dispatch(
        [{ ...request, recipientIds: admins.map((admin) => admin._id) }],
        session,
      );
      return created;
    } catch (error) {
      this.logger.warn(
        `Không gửi được thông báo cho Quản trị (${request.type}): ${(error as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Chuẩn hóa một yêu cầu và dựng nội dung push (một lần cho mọi người nhận vì `vars` giống nhau).
   * Trả `null` khi loại ngoài danh mục hoặc `pushWhen` sai. Loại trong danh mục luôn bị kiểm `vars` (lỗi lập trình
   * lộ ra sớm kể cả khi tình huống này không push).
   */
  private prepareContent(
    request: NotificationRequest,
  ): NotificationPushContent | null {
    if (!request.dedupeKey) {
      throw new Error(
        `Yêu cầu thông báo ${request.type} thiếu dedupeKey (bắt buộc)`,
      );
    }
    const entry = getPushCatalogEntry(request.type);
    if (!entry) return null;
    const rendered = renderPushContent({
      type: request.type,
      vars: request.vars,
      customerId: request.data.customerId
        ? String(request.data.customerId)
        : undefined,
      deepLink: request.data.deepLink,
    });
    if (!entry.pushWhen(request.context ?? {})) return null;
    return { title: rendered.title, body: rendered.body, url: rendered.url };
  }

  /** Người nhận cuối: bỏ trùng và bỏ người thực hiện. */
  private recipientsOf(request: NotificationRequest): Types.ObjectId[] {
    const excluded = new Set((request.excludeUserIds ?? []).map(String));
    const unique = new Map<string, Types.ObjectId>();
    for (const id of request.recipientIds) {
      const key = String(id);
      if (!excluded.has(key) && !unique.has(key)) unique.set(key, id);
    }
    return [...unique.values()];
  }

  private async loadPreferences(
    requests: NotificationRequest[],
    session?: ClientSession,
  ): Promise<Map<string, StoredTypes>> {
    const userIds = [
      ...new Set(requests.flatMap((r) => this.recipientsOf(r).map(String))),
    ].map((id) => new Types.ObjectId(id));
    if (userIds.length === 0) return new Map();
    const rows = await this.preferenceModel
      .find({ userId: { $in: userIds } })
      .select('userId types')
      .session(session ?? null)
      .lean()
      .exec();
    return new Map(
      rows.map((row) => [String(row.userId), row.types as StoredTypes]),
    );
  }

  /** Dựng thao tác upsert cho MỘT (người nhận, yêu cầu) và cho biết thông báo có chờ push không. */
  private buildOperation(
    request: NotificationRequest,
    content: NotificationPushContent | null,
    userId: Types.ObjectId,
    stored: StoredTypes | undefined,
    now: Date,
  ): PreparedOperation {
    const isPending =
      content !== null &&
      this.provider.initialStatus() === NotificationPushStatus.PENDING &&
      isPushEnabled(stored, request.type);
    const doc = {
      userId,
      type: request.type,
      title: clip(request.inApp.title, NOTIFICATION_TITLE_MAX_LENGTH),
      body: clip(request.inApp.body, NOTIFICATION_BODY_MAX_LENGTH),
      data: {
        customerId: request.data.customerId ?? null,
        appointmentId: request.data.appointmentId ?? null,
        requestId: request.data.requestId ?? null,
        deepLink: request.data.deepLink,
      },
      priority: request.inApp.priority ?? NotificationPriority.NORMAL,
      readAt: null,
      pushStatus: isPending
        ? NotificationPushStatus.PENDING
        : NotificationPushStatus.SKIPPED,
      push: isPending ? content : null,
      pushGroupKey: isPending ? (request.context?.groupKey ?? null) : null,
      pushSentAt: null,
      dedupeKey: request.dedupeKey,
      createdAt: now,
    };
    return {
      isPending,
      write: {
        updateOne: {
          filter: { userId, dedupeKey: request.dedupeKey },
          update: { $setOnInsert: doc },
          upsert: true,
        },
      },
    };
  }

  /**
   * Xếp job `push.send` SAU khi transaction commit (không transaction thì chạy ngay). Mọi lỗi (Redis chết) chỉ ghi
   * log: thông báo đã ghi vẫn `PENDING` nên job quét sẽ xếp lại.
   */
  private async enqueueAfterCommit(
    notificationId: string,
    session?: ClientSession,
  ): Promise<void> {
    await registerAfterCommit(session, async () => {
      try {
        await this.queue.add(
          QueueNames.PUSH,
          PushJobNames.SEND,
          { notificationId },
          { jobId: pushSendJobId(notificationId) },
        );
      } catch (error) {
        this.logger.warn(
          `Không xếp được job push cho thông báo ${notificationId} (giữ PENDING, job quét sẽ xếp lại): ${(error as Error).message}`,
        );
      }
    });
  }
}
